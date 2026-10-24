#define NAPI_VERSION 8
#include <node_api.h>
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <memory>
#include <pwd.h>
#include "owned-process.hpp"
#include "source-channel.hpp"
#include "host-quiescence.hpp"

using namespace craft_identity;
namespace {
NSString* const recipientID = @"dev.craft-hub.macos-prototype";
template<typename T> struct CFValue {
  T value = nullptr;
  ~CFValue() { if (value) CFRelease(value); }
};
bool string(id value) { return [value isKindOfClass:[NSString class]]; }
bool matches(NSString* value, NSString* expression) {
  return string(value) && [value rangeOfString:expression options:NSRegularExpressionSearch].location != NSNotFound;
}
bool integer(id value, NSInteger expected) {
  return [value isKindOfClass:[NSNumber class]] && CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID() &&
    [value doubleValue] == static_cast<double>(expected);
}
NSDictionary* information(SecStaticCodeRef code) {
  CFDictionaryRef result = nullptr;
  require(SecCodeCopySigningInformation(code, kSecCSSigningInformation, &result) == errSecSuccess);
  require(result != nullptr);
  return CFBridgingRelease(result);
}
void requirement(CFValue<SecRequirementRef>& result, NSString* identifier, NSString* team) {
  require([identifier length] <= 255 && matches(identifier, @"^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+\\z") &&
          matches(team, @"^[A-Z0-9]{10}\\z"));
  NSString* rule = [NSString stringWithFormat:@"anchor apple generic and identifier \"%@\" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"%@\"", identifier, team];
  require(SecRequirementCreateWithString((__bridge CFStringRef)rule, kSecCSDefaultFlags, &result.value) == errSecSuccess);
}
void validateStatic(SecStaticCodeRef code, SecRequirementRef rule) {
  require(SecStaticCodeCheckValidity(code, kSecCSStrictValidate | kSecCSCheckNestedCode | kSecCSCheckAllArchitectures, rule) == errSecSuccess);
}
void validateDynamic(SecCodeRef code, SecRequirementRef rule) {
  require(SecCodeCheckValidity(code, kSecCSDefaultFlags, rule) == errSecSuccess);
  CFValue<SecStaticCodeRef> disk;
  require(SecCodeCopyStaticCode(code, kSecCSDefaultFlags, &disk.value) == errSecSuccess);
  validateStatic(disk.value, rule);
  require(SecCodeCheckValidity(code, kSecCSDefaultFlags, rule) == errSecSuccess);
}
NSDictionary* policy(NSDictionary* info, NSString* identifier, NSString* team) {
  require([info[(__bridge NSString*)kSecCodeInfoIdentifier] isEqual:identifier] &&
          [info[(__bridge NSString*)kSecCodeInfoTeamIdentifier] isEqual:team]);
  id rawFlags = info[(__bridge NSString*)kSecCodeInfoFlags];
  require([rawFlags isKindOfClass:[NSNumber class]] && CFGetTypeID((__bridge CFTypeRef)rawFlags) != CFBooleanGetTypeID());
  const unsigned long flags = [rawFlags unsignedLongValue];
  require((flags & kSecCodeSignatureRuntime) != 0 && (flags & kSecCodeSignatureAdhoc) == 0);
  NSDictionary* plist = info[(__bridge NSString*)kSecCodeInfoPList];
  require([plist isKindOfClass:[NSDictionary class]] && [plist[@"CFBundleIdentifier"] isEqual:identifier] &&
          integer(plist[@"CraftHubProfileMigrationGuardVersion"], 1));
  id entitlements = info[(__bridge NSString*)kSecCodeInfoEntitlementsDict];
  require(!info[(__bridge NSString*)kSecCodeInfoEntitlements] || entitlements);
  if (entitlements) {
    require([entitlements isKindOfClass:[NSDictionary class]]);
    for (NSString* key in @[@"com.apple.security.get-task-allow", @"com.apple.security.cs.allow-dyld-environment-variables",
                           @"com.apple.security.cs.disable-library-validation", @"com.apple.security.cs.allow-unsigned-executable-memory",
                           @"com.apple.security.cs.disable-executable-page-protection"]) {
      id value = entitlements[key];
      require(!value || (CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID() && ![value boolValue]));
    }
  }
  return plist;
}
NSString* canonical(NSString* path) {
  require(string(path) && [path lengthOfBytesUsingEncoding:NSUTF8StringEncoding] <= 4096 && [path hasPrefix:@"/"] &&
          [path rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"\r\n\0"]].location == NSNotFound);
  char* resolved = realpath([path fileSystemRepresentation], nullptr);
  require(resolved != nullptr);
  NSString* result = [[NSFileManager defaultManager] stringWithFileSystemRepresentation:resolved length:strlen(resolved)];
  free(resolved);
  require([result isEqual:path]);
  return result;
}
NSString* executable(NSDictionary* info, NSString* app, NSDictionary* plist) {
  NSString* name = plist[@"CFBundleExecutable"];
  require(string(name) && [name length] && ![name isEqual:@"."] && ![name isEqual:@".."] && [[name lastPathComponent] isEqual:name]);
  NSString* expected = canonical([app stringByAppendingPathComponent:[@"Contents/MacOS" stringByAppendingPathComponent:name]]);
  NSURL* actual = info[(__bridge NSString*)kSecCodeInfoMainExecutable];
  require([actual isKindOfClass:[NSURL class]] && [actual isFileURL] && [[actual path] isEqual:expected]);
  return expected;
}
struct Launch {
  CFValue<SecCodeRef> source, recipient;
  CFValue<SecRequirementRef> sourceRule, recipientRule;
  std::unique_ptr<OwnedProcess> process;
  std::unique_ptr<SourceChannel> channel;
  NSData* recipientHash;
  NSString* sourceIdentifier;
  explicit Launch(NSString* app, NSData* reviewedSource, NSData* reviewedRecipient) {
    require(SecCodeCopySelf(kSecCSDefaultFlags, &source.value) == errSecSuccess);
    NSDictionary* own = information((SecStaticCodeRef)source.value);
    NSString* sourceID = own[(__bridge NSString*)kSecCodeInfoIdentifier];
    sourceIdentifier = [sourceID copy];
    NSString* team = own[(__bridge NSString*)kSecCodeInfoTeamIdentifier];
    requirement(sourceRule, sourceID, team);
    validateDynamic(source.value, sourceRule.value);
    require([own[(__bridge NSString*)kSecCodeInfoUnique] isEqual:reviewedSource]);
    NSDictionary* sourcePlist = policy(own, sourceID, team);
    NSURL* ownURL = own[(__bridge NSString*)kSecCodeInfoMainExecutable];
    require([ownURL isKindOfClass:[NSURL class]] && [ownURL isFileURL]);
    NSString* sourceApp = [[[ownURL path] stringByDeletingLastPathComponent] stringByDeletingLastPathComponent];
    require([[sourceApp lastPathComponent] isEqual:@"Contents"] && [[[[ownURL path] stringByDeletingLastPathComponent] lastPathComponent] isEqual:@"MacOS"]);
    sourceApp = canonical([sourceApp stringByDeletingLastPathComponent]);
    require([sourceApp hasSuffix:@".app"]);
    executable(own, sourceApp, sourcePlist);
    require(![sourceID isEqual:recipientID] && integer(sourcePlist[@"CraftHubIdentityHostSecurityVersion"], 1) &&
            integer(sourcePlist[@"CraftHubIdentityTransferVersion"], 1) &&
            [sourcePlist[@"CraftHubIdentityRecipientBundleIdentifier"] isEqual:recipientID] &&
            [sourcePlist[@"CraftHubIdentityTransferCapabilities"] isKindOfClass:[NSArray class]] &&
            [sourcePlist[@"CraftHubIdentityTransferCapabilities"] containsObject:@"coordinated-transfer"]);
    app = canonical(app);
    require([app hasSuffix:@".app"]);
    CFValue<SecStaticCodeRef> disk;
    require(SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:app], kSecCSDefaultFlags, &disk.value) == errSecSuccess);
    requirement(recipientRule, recipientID, team);
    validateStatic(disk.value, recipientRule.value);
    NSDictionary* selected = information(disk.value);
    NSDictionary* plist = policy(selected, recipientID, team);
    require(integer(plist[@"CraftHubIdentityRecipientVersion"], 1) && [plist[@"CraftHubIdentitySourceBundleIdentifier"] isEqual:sourceID]);
    NSString* binary = executable(selected, app, plist);
    NSData* hash = selected[(__bridge NSString*)kSecCodeInfoUnique];
    require([hash isKindOfClass:[NSData class]] && [hash length] > 0);
    require([hash isEqual:reviewedRecipient]);
    recipientHash = [hash copy];
    auto* account = getpwuid(getuid());
    require(account && account->pw_dir && account->pw_dir[0] == '/');
    std::vector<std::string> env = {"PATH=/usr/bin:/bin", "LANG=C.UTF-8", std::string("HOME=") + account->pw_dir};
    channel = std::make_unique<SourceChannel>([this](const ch_identity_message& message) { authenticate(message); });
    process = std::make_unique<OwnedProcess>([binary fileSystemRepresentation], env, [&](pid_t pid) {
      NSDictionary* attributes = @{(__bridge NSString*)kSecGuestAttributePid: @(pid)};
      require(SecCodeCopyGuestWithAttributes(nullptr, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &recipient.value) == errSecSuccess);
      validateDynamic(recipient.value, recipientRule.value);
      NSDictionary* running = information((SecStaticCodeRef)recipient.value);
      require([running[(__bridge NSString*)kSecCodeInfoUnique] isEqual:hash]);
      NSDictionary* runningPlist = policy(running, recipientID, team);
      require(integer(runningPlist[@"CraftHubIdentityRecipientVersion"], 1) && [runningPlist[@"CraftHubIdentitySourceBundleIdentifier"] isEqual:sourceID]);
      require([executable(running, app, runningPlist) isEqual:binary]);
      validateDynamic(source.value, sourceRule.value);
    });
    const std::string bootstrap = channel->bootstrap();
    // This fresh pipe has no other writer or data and the address fits below PIPE_BUF. A partial/failed
    // bootstrap retires the child; transaction bytes never use either stdio pipe.
    require(process->write(bootstrap.data(), bootstrap.size()) == bootstrap.size());
  }
  void validate() {
    require(process && !process->status().has_value());
    validateDynamic(source.value, sourceRule.value);
    validateDynamic(recipient.value, recipientRule.value);
    require(!process->status().has_value());
  }
  void authenticate(const ch_identity_message& message) {
    validate();
    require(ch_identity_audit_pid(message.audit, sizeof(message.audit)) == process->pid());
    NSDictionary* attributes = @{(__bridge NSString*)kSecGuestAttributeAudit:
      [NSData dataWithBytes:message.audit length:sizeof(message.audit)]};
    CFValue<SecCodeRef> sender;
    require(SecCodeCopyGuestWithAttributes(nullptr, (__bridge CFDictionaryRef)attributes,
      kSecCSDefaultFlags, &sender.value) == errSecSuccess);
    validateDynamic(sender.value, recipientRule.value);
    require([information((SecStaticCodeRef)sender.value)[(__bridge NSString*)kSecCodeInfoUnique] isEqual:recipientHash]);
    validate();
  }
  std::optional<std::vector<uint8_t>> read() {
    try {
      require(process && !process->status().has_value() && channel);
      return channel->read();
    } catch (...) { close(); throw; }
  }
  size_t write(const void* bytes, size_t size) {
    try {
      validate();
      require(static_cast<bool>(channel));
      return channel->write(bytes, size);
    } catch (...) { close(); throw; }
  }
  void end() { if (channel) channel->close(); if (process) process->end(); }
  void close() { if (channel) channel->close(); if (process) process->close(); }
  void assertHostsStopped() {
    try {
      validate();
      assertNoOtherHosts(getpid(), process->pid(), sourceIdentifier, recipientID);
      validate();
    } catch (...) { close(); throw; }
  }
};

void check(napi_status status) { require(status == napi_ok); }
napi_value undefined(napi_env env) { napi_value result; check(napi_get_undefined(env, &result)); return result; }
napi_value nullValue(napi_env env) { napi_value result; check(napi_get_null(env, &result)); return result; }
napi_value number(napi_env env, int64_t value) { napi_value result; check(napi_create_int64(env, value, &result)); return result; }
Launch* receiver(napi_env env, napi_callback_info info, napi_value* argument = nullptr) {
  napi_value self;
  size_t count = argument ? 1 : 0;
  check(napi_get_cb_info(env, info, &count, argument, &self, nullptr));
  require(!argument || count == 1);
  Launch* value = nullptr;
  check(napi_unwrap(env, self, reinterpret_cast<void**>(&value)));
  require(value && value->process);
  return value;
}
template<typename F> napi_value protect(napi_env env, F action) {
  @autoreleasepool {
    try { return action(); } catch (...) {
      napi_throw_error(env, "CRAFT_HUB_IDENTITY_LAUNCH_REJECTED", "Identity recipient launch was rejected");
      return nullptr;
    }
  }
}
napi_value validate(napi_env env, napi_callback_info info) { return protect(env, [&] {
  auto* value = receiver(env, info);
  try { value->validate(); } catch (...) { value->close(); throw; }
  return undefined(env);
}); }
napi_value assertHostsStopped(napi_env env, napi_callback_info info) { return protect(env, [&] {
  receiver(env, info)->assertHostsStopped(); return undefined(env);
}); }
napi_value status(napi_env env, napi_callback_info info) { return protect(env, [&] {
  auto* owner = receiver(env, info);
  auto value = owner->process->status();
  if (value && owner->channel) owner->channel->close();
  return value ? number(env, *value) : nullValue(env);
}); }
napi_value read(napi_env env, napi_callback_info info) { return protect(env, [&] {
  auto data = receiver(env, info)->read();
  if (!data) return nullValue(env);
  napi_value result; check(napi_create_buffer_copy(env, data->size(), data->data(), nullptr, &result)); return result;
}); }
napi_value write(napi_env env, napi_callback_info info) { return protect(env, [&] {
  napi_value arg; auto* value = receiver(env, info, &arg);
  bool buffer = false; check(napi_is_buffer(env, arg, &buffer)); require(buffer);
  void* bytes; size_t size; check(napi_get_buffer_info(env, arg, &bytes, &size));
  return number(env, value->write(bytes, size));
}); }
napi_value end(napi_env env, napi_callback_info info) { return protect(env, [&] { receiver(env, info)->end(); return undefined(env); }); }
napi_value close(napi_env env, napi_callback_info info) { return protect(env, [&] { receiver(env, info)->close(); return undefined(env); }); }
napi_value launch(napi_env env, napi_callback_info info) { return protect(env, [&] {
  napi_value args[3]; size_t count = 3;
  check(napi_get_cb_info(env, info, &count, args, nullptr, nullptr)); require(count == 3);
  napi_value arg = args[0];
  size_t size; check(napi_get_value_string_utf8(env, arg, nullptr, 0, &size)); require(size > 0 && size <= 4096);
  std::vector<char> bytes(size + 1); check(napi_get_value_string_utf8(env, arg, bytes.data(), bytes.size(), &size));
  require(strlen(bytes.data()) == size);
  NSString* path = [[NSString alloc] initWithBytes:bytes.data() length:size encoding:NSUTF8StringEncoding]; require(path);
  NSData* hashes[2];
  for (size_t index = 0; index < 2; ++index) {
    size_t length;
    check(napi_get_value_string_utf8(env, args[index + 1], nullptr, 0, &length));
    require(length == 40 || length == 64);
    char hex[65]{};
    check(napi_get_value_string_utf8(env, args[index + 1], hex, sizeof(hex), &length));
    NSString* text = [[NSString alloc] initWithBytes:hex length:length encoding:NSUTF8StringEncoding];
    require(matches(text, @"^[a-f0-9]{40}(?:[a-f0-9]{24})?\\z"));
    std::vector<uint8_t> decoded(length / 2);
    for (size_t offset = 0; offset < length; offset += 2) {
      char pair[] = {hex[offset], hex[offset + 1], 0};
      decoded[offset / 2] = static_cast<uint8_t>(strtoul(pair, nullptr, 16));
    }
    hashes[index] = [NSData dataWithBytes:decoded.data() length:decoded.size()];
  }
  auto value = std::make_unique<Launch>(path, hashes[0], hashes[1]);
  napi_value result; check(napi_create_object(env, &result));
  napi_property_descriptor methods[] = {
    {"validate", nullptr, validate, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"assertHostsStopped", nullptr, assertHostsStopped, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"read", nullptr, read, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"write", nullptr, write, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"end", nullptr, end, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"close", nullptr, close, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"status", nullptr, status, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  check(napi_define_properties(env, result, sizeof(methods) / sizeof(methods[0]), methods));
  check(napi_wrap(env, result, value.get(), [](napi_env, void* data, void*) { delete static_cast<Launch*>(data); }, nullptr, nullptr));
  value.release();
  return result;
}); }
napi_value initialize(napi_env env, napi_value exports) {
  return protect(env, [&] { napi_value fn; check(napi_create_function(env, "launch", NAPI_AUTO_LENGTH, launch, nullptr, &fn));
    check(napi_set_named_property(env, exports, "launch", fn)); return exports; });
}
} // namespace
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
