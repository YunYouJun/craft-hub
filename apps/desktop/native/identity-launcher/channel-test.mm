#import <Security/Security.h>
#include "source-channel.hpp"

using namespace craft_identity;
namespace {
// Only this standalone harness accepts its ad hoc fixture. The release addon exposes no auth override.
void authenticate(const ch_identity_message& message, pid_t pid) {
  require(ch_identity_audit_pid(message.audit, sizeof(message.audit)) == pid);
  NSDictionary* attributes = @{(__bridge NSString*)kSecGuestAttributeAudit:
    [NSData dataWithBytes:message.audit length:sizeof(message.audit)]};
  SecCodeRef code = nullptr;
  require(SecCodeCopyGuestWithAttributes(nullptr, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &code) == errSecSuccess && code);
  const OSStatus result = SecCodeCheckValidity(code, kSecCSDefaultFlags, nullptr);
  CFRelease(code);
  require(result == errSecSuccess);
}
struct Session {
  std::unique_ptr<OwnedProcess> child;
  SourceChannel channel;
  std::string service;
  int authenticated = 0;
  bool deny = false;
  Session(const char* fixture, const std::string& mode = "normal"):
      channel([&](const ch_identity_message& message) {
        require(child && !child->status().has_value() && !deny);
        authenticate(message, child->pid());
        ++authenticated;
      }) {
    child = std::make_unique<OwnedProcess>(fixture, std::vector<std::string>{"PATH=/usr/bin:/bin", "CH_TEST_CHANNEL_MODE=" + mode}, [](pid_t) {});
    const std::string bootstrap = channel.bootstrap();
    NSDictionary* object = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:bootstrap.data() length:bootstrap.size()] options:0 error:nil];
    service = [object[@"service"] UTF8String];
    require(child->write(bootstrap.data(), bootstrap.size()) == bootstrap.size());
  }
  std::vector<uint8_t> next() {
    for (int attempt = 0; attempt < 300; ++attempt) {
      auto frame = channel.read();
      if (frame) return *frame;
      usleep(10000);
    }
    throw std::runtime_error("Channel test timed out");
  }
  void ready() {
    const auto frame = next();
    require(std::string(frame.begin(), frame.end()) == "{\"version\":1,\"kind\":\"identity-recipient-ready\"}\n");
    require(authenticated == 2);
  }
  void send(const std::string& data) { require(channel.write(data.data(), data.size()) == data.size()); }
  void unregistered() {
    for (int attempt = 0; attempt < 100; ++attempt) {
      const uint32_t port = ch_identity_port_lookup(service.c_str());
      if (!port) return;
      ch_identity_port_release(port);
      usleep(10000);
    }
    throw std::runtime_error("Channel test leaked its registration");
  }
  template<typename F> void rejected(F action) {
    bool threw = false;
    try { action(); } catch (...) { threw = true; }
    require(threw);
    // Every malformed/authentication failure permanently retires the channel and removes its name.
    unregistered();
    threw = false;
    try { channel.read(); } catch (...) { threw = true; }
    require(threw);
  }
};
}
int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      require(argc == 2);
      {
        Session session(argv[1]); session.ready();
        const std::string maximum(CH_IDENTITY_FRAME_LIMIT, 'z');
        session.send(maximum);
        const auto echoed = session.next();
        require(std::string(echoed.begin(), echoed.end()) == maximum && session.authenticated == 3);
        session.send("finish");
        const auto final = session.next();
        require(std::string(final.begin(), final.end()) == "done" && session.authenticated == 4);
        session.channel.close(); session.channel.close(); session.child->end();
        for (int attempt = 0; attempt < 200 && !session.child->status().has_value(); ++attempt) usleep(10000);
        require(session.child->status() == 0);
        session.unregistered();
      }
      for (const std::string mode : {"boolean-version", "extra-field", "missing-right", "bad-ready", "ready-right", "relay-before"}) {
        Session session(argv[1], mode);
        session.rejected([&] { session.next(); });
      }
      for (const std::string command : {"relay", "exec", "extra-right", "empty"}) {
        Session session(argv[1]); session.ready(); session.send(command);
        session.rejected([&] { session.next(); });
      }
      {
        Session session(argv[1]);
        session.rejected([&] { session.send("premature"); });
      }
      {
        Session session(argv[1]); session.ready();
        session.rejected([&] { session.send(std::string(CH_IDENTITY_FRAME_LIMIT + 1, 'z')); });
      }
      {
        Session session(argv[1]); session.ready(); session.send("echo"); session.deny = true;
        session.rejected([&] { session.next(); });
        require(session.authenticated == 2);
      }
      puts("Source channel authenticated handshake, pipe/relay/exec rejection, frame bounds and retirement passed");
      return 0;
    } catch (const std::exception& error) { fprintf(stderr, "%s\n", error.what()); return 1; }
  }
}
