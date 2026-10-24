#pragma once
#import <Foundation/Foundation.h>
#include "identity-ipc.h"
#include "owned-process.hpp"
#include <array>
#include <cstring>
#include <utility>

namespace craft_identity {
// This class owns the inbox it authenticates. The initial peer right comes only from a kernel message
// on that inbox; neither a JSON payload nor JavaScript can provide a peer port or audit token.
class SourceChannel {
  uint32_t inbox_ = 0, peer_ = 0;
  char service_[CH_IDENTITY_SERVICE_CAPACITY]{};
  std::optional<std::array<uint32_t, 8>> audit_;
  bool ready_ = false;
  std::function<void(const ch_identity_message&)> authenticate_;

  static bool marker(const std::vector<uint8_t>& bytes, NSString* kind) {
    id value = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:bytes.data() length:bytes.size()]
                                               options:0 error:nil];
    if (![value isKindOfClass:[NSDictionary class]] || [value count] != 2) return false;
    id version = value[@"version"];
    return [version isKindOfClass:[NSNumber class]] && CFGetTypeID((__bridge CFTypeRef)version) != CFBooleanGetTypeID() &&
      [version doubleValue] == 1 && [value[@"kind"] isEqual:kind];
  }

 public:
  SourceChannel(const SourceChannel&) = delete;
  SourceChannel& operator=(const SourceChannel&) = delete;
  explicit SourceChannel(std::function<void(const ch_identity_message&)> authenticate): authenticate_(std::move(authenticate)) {
    require(static_cast<bool>(authenticate_));
    inbox_ = ch_identity_port_create(service_, sizeof(service_));
    require(inbox_ != 0);
  }
  ~SourceChannel() { close(); }
  // The private pipe carries only this address and then remains open as a parent lifetime signal.
  std::string bootstrap() const {
    require(inbox_ != 0);
    return std::string("{\"version\":1,\"service\":\"") + service_ + "\"}\n";
  }
  std::optional<std::vector<uint8_t>> read() {
    try {
      require(inbox_ != 0);
      struct Received {
        ch_identity_message message{};
        ~Received() { ch_identity_port_release(message.reply_port); }
      } received;
      auto& message = received.message;
      std::vector<uint8_t> bytes(CH_IDENTITY_FRAME_LIMIT);
      const int result = ch_identity_receive(inbox_, bytes.data(), bytes.size(), &message, 0);
      if (result == 0) return std::nullopt;
      require(result == 1);
      // Pin the kernel token, including its exec generation. The validator additionally checks the owned
      // child's current signature and selected CDHash on every message, before parsing any payload.
      std::array<uint32_t, 8> token;
      std::memcpy(token.data(), message.audit, sizeof(message.audit));
      require(!audit_ || *audit_ == token);
      authenticate_(message);
      audit_ = token;
      bytes.resize(message.count);
      if (!peer_) {
        require(message.reply_port != 0 && marker(bytes, @"identity-recipient-channel-ready"));
        peer_ = std::exchange(message.reply_port, 0);
        require(ch_identity_send(peer_, 0, nullptr, 0, 2000) == 0);
        return std::nullopt;
      }
      require(message.reply_port == 0);
      if (!ready_) {
        require(marker(bytes, @"identity-recipient-ready"));
        ready_ = true;
      }
      require(!bytes.empty());
      return bytes;
    } catch (...) { close(); throw; }
  }
  // One complete authenticated frame; there is no raw pipe write surface and no partial-write contract.
  size_t write(const void* bytes, size_t count) {
    try {
      require(inbox_ && peer_ && ready_ && count > 0 && count <= CH_IDENTITY_FRAME_LIMIT);
      require(ch_identity_send(peer_, 0, bytes, count, 2000) == 0);
      return count;
    } catch (...) { close(); throw; }
  }
  void close() {
    ch_identity_port_release(std::exchange(peer_, 0));
    ch_identity_port_destroy(std::exchange(inbox_, 0));
    audit_.reset();
    ready_ = false;
  }
};
} // namespace craft_identity
