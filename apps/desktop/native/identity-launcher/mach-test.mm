#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include "identity-ipc.h"
#include "owned-process.hpp"
#include <mach/mach.h>

using namespace craft_identity;
#define require(value) do { if (!(value)) throw std::runtime_error("Mach verification failed at line " + std::to_string(__LINE__)); } while (0)
namespace {
struct Port {
  uint32_t value;
  bool receive;
  Port(uint32_t p, bool r): value(p), receive(r) { require(p != 0); }
  Port(const Port&) = delete;
  ~Port() { if (receive) ch_identity_port_destroy(value); else ch_identity_port_release(value); }
};
struct Frame {
  std::vector<unsigned char> data = std::vector<unsigned char>(CH_IDENTITY_FRAME_LIMIT);
  ch_identity_message message{};
  explicit Frame(uint32_t port) {
    require(ch_identity_receive(port, data.data(), data.size(), &message, 2000) == 1);
    data.resize(message.count);
  }
  Frame(const Frame&) = delete;
  ~Frame() { ch_identity_port_release(message.reply_port); }
  bool is(const char* value) const { return std::string(data.begin(), data.end()) == value; }
};
struct Child {
  pid_t pid = -1;
  Child(const char* binary, char* service) {
    char* argv[] = {const_cast<char*>(binary), service, nullptr};
    char path[] = "PATH=/usr/bin:/bin";
    char* env[] = {path, nullptr};
    require(posix_spawn(&pid, binary, nullptr, nullptr, argv, env) == 0);
  }
  ~Child() {
    if (pid <= 0) return;
    int status;
    pid_t result;
    do { result = waitpid(pid, &status, WNOHANG); } while (result < 0 && errno == EINTR);
    if (result == 0) {
      kill(pid, SIGKILL);
      while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    }
  }
};
bool signedSender(const ch_identity_message& message, pid_t expected) {
  if (ch_identity_audit_pid(message.audit, sizeof(message.audit)) != expected) return false;
  NSDictionary* attributes = @{(__bridge NSString*)kSecGuestAttributeAudit:
    [NSData dataWithBytes:message.audit length:sizeof(message.audit)]};
  SecCodeRef code = nullptr;
  OSStatus result = SecCodeCopyGuestWithAttributes(nullptr, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &code);
  if (result != errSecSuccess || !code) return false;
  // Only this standalone harness accepts an ad hoc fixture. Release validation requires Developer ID and both contracts.
  result = SecCodeCheckValidity(code, kSecCSDefaultFlags, nullptr);
  CFRelease(code);
  return result == errSecSuccess;
}
void send(uint32_t port, const char* value) { require(ch_identity_send(port, 0, value, strlen(value), 2000) == 0); }
void rightsAndBounds() {
  Port receive(ch_identity_port_create(nullptr, 0), true), reply(ch_identity_port_create(nullptr, 0), true);
  mach_port_limits_t limits{1};
  require(mach_port_set_attributes(mach_task_self(), receive.value, MACH_PORT_LIMITS_INFO,
    reinterpret_cast<mach_port_info_t>(&limits), MACH_PORT_LIMITS_INFO_COUNT) == KERN_SUCCESS);
  mach_port_urefs_t before, after;
  require(mach_port_get_refs(mach_task_self(), reply.value, MACH_PORT_RIGHT_SEND, &before) == KERN_SUCCESS);
  require(ch_identity_send(receive.value, reply.value, "one", 3, 0) == 0);
  for (int i = 0; i < 10; ++i) require(ch_identity_send(receive.value, reply.value, "overflow", 8, 0) == -1);
  { Frame first(receive.value); require(first.is("one") && first.message.reply_port == reply.value); }
  require(mach_port_get_refs(mach_task_self(), reply.value, MACH_PORT_RIGHT_SEND, &after) == KERN_SUCCESS && before == after);
  std::vector<unsigned char> oversized(CH_IDENTITY_FRAME_LIMIT + 1, 65);
  require(ch_identity_send(receive.value, reply.value, oversized.data(), oversized.size(), 0) == -1);
  require(ch_identity_send(receive.value, reply.value, "too big", 7, 0) == 0);
  unsigned char small[2]; ch_identity_message message{};
  require(ch_identity_receive(receive.value, small, sizeof(small), &message, 0) == -1);
  require(message.reply_port == 0);
  require(mach_port_get_refs(mach_task_self(), reply.value, MACH_PORT_RIGHT_SEND, &after) == KERN_SUCCESS && before == after);
  require(ch_identity_receive(receive.value, small, sizeof(small), &message, 0) == 0);
  struct Invalid {
    mach_msg_header_t header{};
    uint32_t version = 2, count = 0;
  } invalid;
  invalid.header.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, MACH_MSG_TYPE_MAKE_SEND);
  invalid.header.msgh_remote_port = receive.value;
  invalid.header.msgh_local_port = reply.value;
  invalid.header.msgh_size = sizeof(invalid);
  invalid.header.msgh_id = 0x43484944;
  require(mach_msg(&invalid.header, MACH_SEND_MSG | MACH_SEND_TIMEOUT, sizeof(invalid), 0, 0, 0, 0) == KERN_SUCCESS);
  require(ch_identity_receive(receive.value, small, sizeof(small), &message, 0) == -1);
  struct Complex {
    mach_msg_header_t header{};
    mach_msg_body_t body{1};
    mach_msg_port_descriptor_t descriptor{};
  } complex;
  complex.header.msgh_bits = MACH_MSGH_BITS_COMPLEX | MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0);
  complex.header.msgh_remote_port = receive.value;
  complex.header.msgh_size = sizeof(complex);
  complex.header.msgh_id = 0x43484944;
  complex.descriptor.name = reply.value;
  complex.descriptor.disposition = MACH_MSG_TYPE_MAKE_SEND;
  complex.descriptor.type = MACH_MSG_PORT_DESCRIPTOR;
  require(mach_msg(&complex.header, MACH_SEND_MSG | MACH_SEND_TIMEOUT, sizeof(complex), 0, 0, 0, 0) == KERN_SUCCESS);
  require(ch_identity_receive(receive.value, small, sizeof(small), &message, 0) == -1);
  require(mach_port_get_refs(mach_task_self(), reply.value, MACH_PORT_RIGHT_SEND, &after) == KERN_SUCCESS && before == after);
  std::vector<unsigned char> overWire(CH_IDENTITY_FRAME_LIMIT + MAX_TRAILER_SIZE + 64);
  auto* header = reinterpret_cast<mach_msg_header_t*>(overWire.data());
  header->msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, MACH_MSG_TYPE_MAKE_SEND);
  header->msgh_remote_port = receive.value;
  header->msgh_local_port = reply.value;
  header->msgh_size = static_cast<mach_msg_size_t>(overWire.size());
  require(mach_msg(header, MACH_SEND_MSG | MACH_SEND_TIMEOUT, header->msgh_size, 0, 0, 0, 0) == KERN_SUCCESS);
  require(ch_identity_receive(receive.value, small, sizeof(small), &message, 0) == -1);
  require(ch_identity_receive(receive.value, small, sizeof(small), &message, 0) == 0);
  require(mach_port_get_refs(mach_task_self(), reply.value, MACH_PORT_RIGHT_SEND, &after) == KERN_SUCCESS && before == after);
  uint32_t dead = ch_identity_port_create(nullptr, 0);
  require(dead && mach_port_mod_refs(mach_task_self(), dead, MACH_PORT_RIGHT_SEND, 1) == KERN_SUCCESS);
  ch_identity_port_destroy(dead);
  for (int i = 0; i < 10; ++i) require(ch_identity_send(dead, reply.value, "closed", 6, 0) == -1);
  mach_port_urefs_t deadReferences = 0;
  require(mach_port_get_refs(mach_task_self(), dead, MACH_PORT_RIGHT_DEAD_NAME, &deadReferences) == KERN_SUCCESS && deadReferences == 1);
  ch_identity_port_release(dead);
  require(mach_port_get_refs(mach_task_self(), reply.value, MACH_PORT_RIGHT_SEND, &after) == KERN_SUCCESS && before == after);
  require(ch_identity_port_lookup("com.apple.unrelated") == 0);
}
}
int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      require(argc == 2);
      rightsAndBounds();
      char service[CH_IDENTITY_SERVICE_CAPACITY];
      {
        Port source(ch_identity_port_create(service, sizeof(service)), true);
        Child child(argv[1], service);
        Frame hello(source.value);
        require(hello.is("initial") && hello.message.reply_port && signedSender(hello.message, child.pid));
        std::vector<unsigned char> payload(CH_IDENTITY_FRAME_LIMIT, 42);
        require(ch_identity_send(hello.message.reply_port, 0, payload.data(), payload.size(), 2000) == 0);
        { Frame echoed(source.value); require(echoed.data == payload && signedSender(echoed.message, child.pid)); }
        send(hello.message.reply_port, "relay");
        { Frame forged(source.value);
          require(!signedSender(forged.message, child.pid));
          require(std::string(forged.data.begin(), forged.data.end()).find(std::to_string(child.pid)) != std::string::npos);
        }
        { Frame legitimate(source.value); require(legitimate.is("legitimate") && signedSender(legitimate.message, child.pid)); }
        send(hello.message.reply_port, "exec");
        Frame execed(source.value);
        require(execed.is("execed") && signedSender(execed.message, child.pid));
        require(memcmp(hello.message.audit, execed.message.audit, sizeof(hello.message.audit)) != 0);
        require(!signedSender(hello.message, child.pid));
        send(execed.message.reply_port, "finish");
        int status;
        require(waitpid(child.pid, &status, 0) == child.pid && status == 0);
        child.pid = -1;
      }
      uint32_t leftover = 0;
      for (int attempt = 0; attempt < 100; ++attempt) {
        leftover = ch_identity_port_lookup(service);
        if (!leftover) break;
        ch_identity_port_release(leftover);
        usleep(10000);
      }
      require(leftover == 0);
      puts("Mach audit tokens, relay/exec rejection, bounded frames, rights cleanup and transient registration passed");
      return 0;
    } catch (const std::exception& error) { fprintf(stderr, "%s\n", error.what()); return 1; }
  }
}
