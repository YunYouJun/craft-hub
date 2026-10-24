#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum { CH_IDENTITY_FRAME_LIMIT = 65536, CH_IDENTITY_SERVICE_CAPACITY = 128 };
typedef struct {
  uint32_t reply_port;
  uint32_t audit[8];
  size_t count;
} ch_identity_message;

// All returned ports are owned. Destroy receive ports; release send rights, including each received reply_port.
// A published name is an address only. Callers MUST authenticate the kernel audit token before using any payload/right.
uint32_t ch_identity_port_create(char *service, size_t capacity);
uint32_t ch_identity_port_lookup(const char *service);
void ch_identity_port_destroy(uint32_t port);
void ch_identity_port_release(uint32_t port);
int ch_identity_send(uint32_t destination, uint32_t reply, const void *bytes, size_t count, uint32_t timeout_ms);
// 1: received; 0: timeout; -1: malformed/error. A successful receive transfers ownership of message.reply_port.
int ch_identity_receive(uint32_t port, void *bytes, size_t capacity, ch_identity_message *message, uint32_t timeout_ms);
int32_t ch_identity_audit_pid(const void *bytes, size_t count);

#ifdef __cplusplus
}
#endif
