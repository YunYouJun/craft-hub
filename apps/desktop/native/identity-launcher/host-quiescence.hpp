#pragma once
#import <AppKit/AppKit.h>
#include <libproc.h>
#include <algorithm>
#include "owned-process.hpp"

namespace craft_identity {
// A supplementary check for older hosts without kernel leases. A caller must still confirm that older
// CLI writers and renamed downstream hosts are closed. This code never stops another application.
inline std::vector<pid_t> otherHostProcesses(pid_t source, pid_t recipient, NSString* sourceID, NSString* recipientID) {
  std::vector<pid_t> hosts;
  for (NSRunningApplication* application in [[NSWorkspace sharedWorkspace] runningApplications]) {
    const pid_t pid = [application processIdentifier];
    if (pid == source || pid == recipient) continue;
    NSString* identifier = [application bundleIdentifier];
    if ([identifier isEqual:sourceID] || [identifier isEqual:recipientID]) hosts.push_back(pid);
  }
  const int estimate = proc_listallpids(nullptr, 0);
  require(estimate > 0 && estimate < 100000);
  std::vector<pid_t> processes(static_cast<size_t>(estimate) + 4096);
  const int count = proc_listallpids(processes.data(), static_cast<int>(processes.size() * sizeof(pid_t)));
  require(count > 0 && static_cast<size_t>(count) < processes.size());
  for (int index = 0; index < count; ++index) {
    const pid_t pid = processes[static_cast<size_t>(index)];
    if (pid <= 0 || pid == source || pid == recipient) continue;
    char bytes[PROC_PIDPATHINFO_MAXSIZE]{};
    if (proc_pidpath(pid, bytes, sizeof(bytes)) <= 0) continue;
    NSString* executable = [[NSFileManager defaultManager] stringWithFileSystemRepresentation:bytes length:strlen(bytes)];
    if ([executable rangeOfString:@"/Craft Hub[^/]*\\.app/Contents/MacOS/" options:NSRegularExpressionSearch | NSCaseInsensitiveSearch].location != NSNotFound &&
        std::find(hosts.begin(), hosts.end(), pid) == hosts.end()) hosts.push_back(pid);
  }
  return hosts;
}
inline void assertNoOtherHosts(pid_t source, pid_t recipient, NSString* sourceID, NSString* recipientID) {
  require(otherHostProcesses(source, recipient, sourceID, recipientID).empty());
}
} // namespace craft_identity
