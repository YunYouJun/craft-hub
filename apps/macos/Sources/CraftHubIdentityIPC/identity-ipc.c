#include "identity-ipc.h"
#include <mach/mach.h>
#include <bsm/libbsm.h>
#include <servers/bootstrap.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uuid/uuid.h>

static const char prefix[] = "dev.craft-hub.identity.";
enum { message_id = 0x43484944, wire_version = 1 };
typedef struct {
  mach_msg_header_t header;
  uint32_t version;
  uint32_t count;
  unsigned char bytes[CH_IDENTITY_FRAME_LIMIT];
} packet;
static size_t aligned(size_t size) { return (size + 3) & ~(size_t)3; }

uint32_t ch_identity_port_create(char *service, size_t capacity) {
  if (service && capacity < CH_IDENTITY_SERVICE_CAPACITY) return MACH_PORT_NULL;
  mach_port_t port = MACH_PORT_NULL;
  mach_port_options_t options = {.flags = MPO_INSERT_SEND_RIGHT};
  if (mach_port_construct(mach_task_self(), &options, 0, &port) != KERN_SUCCESS) return MACH_PORT_NULL;
  if (service) {
    uuid_t uuid;
    char identifier[37];
    uuid_generate_random(uuid);
    uuid_unparse_lower(uuid, identifier);
    snprintf(service, capacity, "%s%s", prefix, identifier);
    // Public but deprecated rendezvous API. No launch agent is installed. Destroying the receive right
    // removes this transient registration; bootstrap_register(..., MACH_PORT_NULL) is not authorized.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    kern_return_t result = bootstrap_register(bootstrap_port, service, port);
#pragma clang diagnostic pop
    if (result != KERN_SUCCESS) {
      ch_identity_port_destroy(port);
      service[0] = 0;
      return MACH_PORT_NULL;
    }
  }
  return port;
}

uint32_t ch_identity_port_lookup(const char *service) {
  if (!service || strnlen(service, CH_IDENTITY_SERVICE_CAPACITY) != strlen(prefix) + 36 ||
      strncmp(service, prefix, strlen(prefix)) != 0) return MACH_PORT_NULL;
  const char *identifier = service + strlen(prefix);
  for (size_t i = 0; i < 36; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (identifier[i] != '-') return MACH_PORT_NULL; }
    else if (!((identifier[i] >= '0' && identifier[i] <= '9') || (identifier[i] >= 'a' && identifier[i] <= 'f'))) {
      return MACH_PORT_NULL;
    }
  }
  mach_port_t port = MACH_PORT_NULL;
  if (bootstrap_look_up(bootstrap_port, service, &port) != KERN_SUCCESS) return MACH_PORT_NULL;
  return port;
}

void ch_identity_port_destroy(uint32_t port) {
  // Drop exactly our receive right and the one send reference created alongside it.
  if (MACH_PORT_VALID(port)) mach_port_destruct(mach_task_self(), port, -1, 0);
}
void ch_identity_port_release(uint32_t port) {
  if (MACH_PORT_VALID(port)) mach_port_deallocate(mach_task_self(), port);
}

int32_t ch_identity_audit_pid(const void *bytes, size_t count) {
  if (!bytes || count != sizeof(audit_token_t)) return -1;
  audit_token_t token;
  memcpy(&token, bytes, count);
  return audit_token_to_pid(token);
}

int ch_identity_send(uint32_t destination, uint32_t reply, const void *bytes, size_t count, uint32_t timeout_ms) {
  if (!MACH_PORT_VALID(destination) || count > CH_IDENTITY_FRAME_LIMIT || (count && !bytes) || timeout_ms > 2000) return -1;
  const size_t size = aligned(offsetof(packet, bytes) + count);
  packet *value = calloc(1, size);
  if (!value) return -1;
  value->header.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, reply ? MACH_MSG_TYPE_MAKE_SEND : 0);
  value->header.msgh_remote_port = destination;
  value->header.msgh_local_port = reply;
  value->header.msgh_id = message_id;
  value->header.msgh_size = (mach_msg_size_t)size;
  value->version = wire_version;
  value->count = (uint32_t)count;
  if (count) memcpy(value->bytes, bytes, count);
  kern_return_t result = mach_msg(&value->header, MACH_SEND_MSG | MACH_SEND_TIMEOUT,
    (mach_msg_size_t)size, 0, MACH_PORT_NULL, timeout_ms, MACH_PORT_NULL);
  // A timed-out send is copied back out by the kernel. Retire the additional rights from that pseudo-receive;
  // the original COPY_SEND/MAKE_SEND references remain owned by the caller.
  if (result == MACH_SEND_TIMED_OUT || result == MACH_SEND_INTERRUPTED || result == MACH_SEND_INVALID_DEST) {
    if (MACH_MSGH_BITS_LOCAL(value->header.msgh_bits) == MACH_MSG_TYPE_MOVE_SEND) {
      ch_identity_port_release(value->header.msgh_local_port);
      value->header.msgh_local_port = MACH_PORT_NULL;
    }
    mach_msg_destroy(&value->header);
  }
  free(value);
  return result == KERN_SUCCESS ? 0 : -1;
}

int ch_identity_receive(uint32_t port, void *bytes, size_t capacity, ch_identity_message *message, uint32_t timeout_ms) {
  if (!MACH_PORT_VALID(port) || !message || !bytes || capacity > CH_IDENTITY_FRAME_LIMIT || timeout_ms > 2000) return -1;
  memset(message, 0, sizeof(*message));
  const size_t storage = sizeof(packet) + MAX_TRAILER_SIZE;
  packet *value = calloc(1, storage);
  if (!value) return -1;
  kern_return_t result = mach_msg(&value->header,
    MACH_RCV_MSG | MACH_RCV_TIMEOUT | MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0) |
      MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT),
    0, (mach_msg_size_t)storage, port, timeout_ms, MACH_PORT_NULL);
  if (result != KERN_SUCCESS) { free(value); return result == MACH_RCV_TIMED_OUT ? 0 : -1; }
  size_t size = value->header.msgh_size;
  if ((value->header.msgh_bits & MACH_MSGH_BITS_COMPLEX) || value->header.msgh_id != message_id ||
      size < offsetof(packet, bytes) || size > sizeof(packet) || value->version != wire_version ||
      value->count > capacity || size != aligned(offsetof(packet, bytes) + value->count) ||
      (value->header.msgh_remote_port && MACH_MSGH_BITS_REMOTE(value->header.msgh_bits) != MACH_MSG_TYPE_PORT_SEND)) {
    mach_msg_destroy(&value->header);
    free(value);
    return -1;
  }
  mach_msg_audit_trailer_t *trailer = (void *)((unsigned char *)value + aligned(size));
  if (trailer->msgh_trailer_type != MACH_MSG_TRAILER_FORMAT_0 ||
      trailer->msgh_trailer_size < sizeof(*trailer) || trailer->msgh_trailer_size > MAX_TRAILER_SIZE) {
    mach_msg_destroy(&value->header);
    free(value);
    return -1;
  }
  memcpy(bytes, value->bytes, value->count);
  memcpy(message->audit, &trailer->msgh_audit, sizeof(message->audit));
  message->count = value->count;
  message->reply_port = value->header.msgh_remote_port;
  value->header.msgh_remote_port = MACH_PORT_NULL;
  mach_msg_destroy(&value->header);
  free(value);
  return 1;
}
