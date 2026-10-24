#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <libproc.h>
#include <sys/proc.h>
#include "owned-process.hpp"

using namespace craft_identity;

// Standalone tests exercise the process primitive with an explicit fixture-only validator. The release addon
// has no equivalent switch, PID argument or caller-defined validator; its real rejection is tested separately.
int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      require(argc == 2);
      const std::string fixture = argv[1];
      pid_t rejectedPID = -1;
      bool suspended = false, rejected = false;
      try {
        OwnedProcess denied(fixture, {"PATH=/usr/bin:/bin"}, [&](pid_t pid) {
          rejectedPID = pid;
          proc_bsdinfo info{};
          require(proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) == sizeof(info));
          require(info.pbi_ppid == static_cast<uint32_t>(getpid()));
          suspended = info.pbi_status == SSTOP;
          require(suspended);
          throw std::runtime_error("fixture rejection");
        });
      } catch (...) { rejected = true; }
      require(rejected && suspended && rejectedPID > 0);
      for (int attempt = 0; attempt < 200 && kill(rejectedPID, 0) == 0; ++attempt) usleep(10000);
      require(kill(rejectedPID, 0) == -1 && errno == ESRCH);

      // Deliberately leave an unrelated descriptor without CLOEXEC; the child's report must contain only 0/1/2.
      Descriptor unrelated(open("/dev/null", O_RDONLY));
      require(unrelated.value >= 3 && fcntl(unrelated.value, F_SETFD, 0) == 0);
      bool validatedWhileSuspended = false;
      OwnedProcess accepted(fixture, {"PATH=/usr/bin:/bin"}, [&](pid_t pid) {
        proc_bsdinfo state{};
        require(proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &state, sizeof(state)) == sizeof(state) && state.pbi_status == SSTOP);
        SecCodeRef code = nullptr;
        NSDictionary* attributes = @{(__bridge NSString*)kSecGuestAttributePid: @(pid)};
        require(SecCodeCopyGuestWithAttributes(nullptr, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &code) == errSecSuccess);
        require(code != nullptr);
        // An ad hoc fixture is acceptable only to this test callback. Production requires Developer ID and both contracts.
        const OSStatus valid = SecCodeCheckValidity(code, kSecCSDefaultFlags, nullptr);
        CFDictionaryRef signing = nullptr;
        const OSStatus copied = SecCodeCopySigningInformation((SecStaticCodeRef)code, kSecCSSigningInformation, &signing);
        CFRelease(code);
        require(valid == errSecSuccess && copied == errSecSuccess && signing != nullptr);
        NSDictionary* info = CFBridgingRelease(signing);
        NSURL* executable = info[(__bridge NSString*)kSecCodeInfoMainExecutable];
        require([[executable path] isEqual:[NSString stringWithUTF8String:fixture.c_str()]]);
        validatedWhileSuspended = true;
      });
      require(validatedWhileSuspended);
      std::string output;
      for (int attempt = 0; attempt < 200 && output.find('\n') == std::string::npos; ++attempt) {
        auto bytes = accepted.read();
        if (bytes) output.append(bytes->begin(), bytes->end());
        usleep(10000);
      }
      require(output == "owned-private-pipes-ready\n");
      const char message[] = "finish\n";
      require(accepted.write(message, sizeof(message) - 1) == sizeof(message) - 1);
      accepted.end();
      for (int attempt = 0; attempt < 200 && !accepted.status().has_value(); ++attempt) usleep(10000);
      require(accepted.status() == 0);
      // Once reaped, closing/revalidating cannot signal a recycled PID.
      require(accepted.pid() == -1);
      accepted.close();
      accepted.close();
      puts("suspended validation, rejection cleanup, descriptor isolation and child reaping passed");
      return 0;
    } catch (...) {
      fputs("Owned identity process verification failed\n", stderr);
      return 1;
    }
  }
}
