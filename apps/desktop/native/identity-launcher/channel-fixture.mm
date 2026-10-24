#import <Foundation/Foundation.h>
#include "identity-ipc.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <sys/wait.h>
#include <unistd.h>

// Standalone test peer. No identity/vault access and never included in the packaged application.
int main(int argc, char** argv) {
  @autoreleasepool {
    const bool execed = argc == 3 && !strcmp(argv[1], "--execed");
    if (!execed && (argc != 2 || strcmp(argv[1], "--craft-hub-native-identity-recipient"))) return 1;
    char bootstrap[512];
    NSString* service;
    if (execed) service = [NSString stringWithUTF8String:argv[2]];
    else {
      if (!fgets(bootstrap, sizeof(bootstrap), stdin)) return 2;
      NSDictionary* object = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:bootstrap length:strlen(bootstrap)] options:0 error:nil];
      service = object[@"service"];
    }
    if (![service isKindOfClass:[NSString class]]) return 3;
    uint32_t source = ch_identity_port_lookup([service UTF8String]);
    uint32_t receiver = ch_identity_port_create(nullptr, 0);
    if (!source || !receiver) return 4;
    const char* rawMode = getenv("CH_TEST_CHANNEL_MODE");
    const std::string mode = rawMode ? rawMode : "normal";
    const char* hello = mode == "boolean-version" ? "{\"version\":true,\"kind\":\"identity-recipient-channel-ready\"}" :
      mode == "extra-field" ? "{\"version\":1,\"kind\":\"identity-recipient-channel-ready\",\"key\":\"untrusted\"}" :
      "{\"version\":1,\"kind\":\"identity-recipient-channel-ready\"}";
    // Deliberate pipe spoofing must never be surfaced by SourceChannel.read().
    fputs("{\"pipe\":\"forged\"}\n", stdout); fflush(stdout);
    if (mode == "relay-before") {
      pid_t helper = fork();
      if (helper < 0) return 5;
      if (!helper) {
        uint32_t port = ch_identity_port_lookup([service UTF8String]);
        uint32_t reply = ch_identity_port_create(nullptr, 0);
        _exit(ch_identity_send(port, reply, hello, strlen(hello), 2000) == 0 ? 0 : 1);
      }
      int status;
      if (waitpid(helper, &status, 0) != helper || status != 0) return 6;
    }
    if (ch_identity_send(source, mode == "missing-right" ? 0 : receiver, hello, strlen(hello), 2000)) return 7;
    unsigned char bytes[CH_IDENTITY_FRAME_LIMIT];
    ch_identity_message message{};
    if (ch_identity_receive(receiver, bytes, sizeof(bytes), &message, 2000) != 1 || message.count || message.reply_port) return 8;
    const char* ready = mode == "bad-ready" ? "{\"version\":1,\"kind\":\"wrong\"}" : "{\"version\":1,\"kind\":\"identity-recipient-ready\"}\n";
    if (ch_identity_send(source, mode == "ready-right" ? receiver : 0, ready, strlen(ready), 2000)) return 9;
    for (;;) {
      if (ch_identity_receive(receiver, bytes, sizeof(bytes), &message, 2000) != 1 || message.reply_port) return 10;
      const std::string command(reinterpret_cast<char*>(bytes), message.count);
      if (command == "exec") {
        char* args[] = {argv[0], const_cast<char*>("--execed"), const_cast<char*>([service UTF8String]), nullptr};
        execv(argv[0], args);
        return 11;
      }
      if (command == "relay") {
        pid_t helper = fork();
        if (helper < 0) return 12;
        if (!helper) {
          uint32_t port = ch_identity_port_lookup([service UTF8String]);
          char forged[128];
          int count = snprintf(forged, sizeof(forged), "{\"claimedPID\":%d}", getppid());
          _exit(ch_identity_send(port, 0, forged, static_cast<size_t>(count), 2000) == 0 ? 0 : 1);
        }
        int status;
        if (waitpid(helper, &status, 0) != helper || status != 0) return 13;
      } else if (command == "finish") {
        if (ch_identity_send(source, 0, "done", 4, 2000)) return 14;
        if (getchar() != EOF) return 15;
        ch_identity_port_destroy(receiver);
        ch_identity_port_release(source);
        return 0;
      } else if (command == "empty") {
        if (ch_identity_send(source, 0, nullptr, 0, 2000)) return 16;
      } else if (ch_identity_send(source, command == "extra-right" ? receiver : 0, bytes, message.count, 2000)) return 17;
    }
  }
}
