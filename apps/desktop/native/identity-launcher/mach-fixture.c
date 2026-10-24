#include "identity-ipc.h"
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

// Disposable fixture only. It carries no identity, vault or production authentication override.
int main(int argc, char **argv) {
  if (argc < 2 || argc > 3) return 1;
  uint32_t source = ch_identity_port_lookup(argv[1]);
  uint32_t receiver = ch_identity_port_create(NULL, 0);
  if (!source || !receiver) return 2;
  const char *hello = argc == 3 ? "execed" : "initial";
  if (ch_identity_send(source, receiver, hello, strlen(hello), 2000)) return 3;
  unsigned char bytes[CH_IDENTITY_FRAME_LIMIT];
  for (;;) {
    ch_identity_message message;
    if (ch_identity_receive(receiver, bytes, sizeof(bytes), &message, 2000) != 1) return 4;
    if (message.reply_port) { ch_identity_port_release(message.reply_port); return 5; }
    if (message.count == 5 && !memcmp(bytes, "relay", 5)) {
      pid_t helper = fork();
      if (helper < 0) return 6;
      if (!helper) {
        uint32_t borrowed = ch_identity_port_lookup(argv[1]);
        char forged[128];
        int count = snprintf(forged, sizeof(forged), "{\"claimedPID\":%d}", getppid());
        int result = ch_identity_send(borrowed, 0, forged, (size_t)count, 2000);
        ch_identity_port_release(borrowed);
        _exit(result ? 7 : 0);
      }
      int status;
      if (waitpid(helper, &status, 0) != helper || status != 0) return 8;
      if (ch_identity_send(source, 0, "legitimate", 10, 2000)) return 9;
    } else if (message.count == 4 && !memcmp(bytes, "exec", 4)) {
      char *arguments[] = {argv[0], argv[1], "execed", NULL};
      execv(argv[0], arguments);
      return 10;
    } else if (message.count == 6 && !memcmp(bytes, "finish", 6)) {
      ch_identity_port_destroy(receiver);
      ch_identity_port_release(source);
      return 0;
    } else if (ch_identity_send(source, 0, bytes, message.count, 2000)) { return 11; }
  }
}
