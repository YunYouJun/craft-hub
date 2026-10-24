#pragma once
#include <cerrno>
#include <csignal>
#include <dispatch/dispatch.h>
#include <fcntl.h>
#include <functional>
#include <optional>
#include <spawn.h>
#include <stdexcept>
#include <string>
#include <sys/wait.h>
#include <unistd.h>
#include <vector>

namespace craft_identity {
inline void require(bool value) {
  if (!value) throw std::runtime_error("Identity recipient launch was rejected");
}
struct Descriptor {
  int value = -1;
  Descriptor() = default;
  explicit Descriptor(int fd) : value(fd) {}
  Descriptor(const Descriptor&) = delete;
  Descriptor& operator=(const Descriptor&) = delete;
  ~Descriptor() { reset(); }
  void reset(int next = -1) { if (value >= 0) ::close(value); value = next; }
};

// Owns the exact spawned child. No PID supplied by JavaScript can ever be validated, resumed or killed.
// Start suspended and authenticate before this owner resumes the child.
// This is process ownership, not message authentication: another same-user process can send SIGCONT.
// A production coordinator must additionally authenticate each IPC peer/message before accepting any transfer key.
class OwnedProcess {
  pid_t pid_ = -1;
  Descriptor input_, output_;
  std::optional<int> exit_;
 public:
  OwnedProcess(const OwnedProcess&) = delete;
  OwnedProcess& operator=(const OwnedProcess&) = delete;
  OwnedProcess(const std::string& executable, const std::vector<std::string>& environment,
               const std::function<void(pid_t)>& authenticate) {
    int incoming[2], outgoing[2];
    require(pipe(incoming) == 0);
    Descriptor childInput(incoming[0]);
    input_.reset(incoming[1]);
    require(pipe(outgoing) == 0);
    output_.reset(outgoing[0]);
    Descriptor childOutput(outgoing[1]);
    Descriptor errors(open("/dev/null", O_WRONLY | O_CLOEXEC));
    require(errors.value >= 0);
    for (int fd : {childInput.value, input_.value, output_.value, childOutput.value})
      require(fcntl(fd, F_SETFD, FD_CLOEXEC) == 0);
    require(fcntl(input_.value, F_SETNOSIGPIPE, 1) == 0);
    for (int fd : {input_.value, output_.value})
      require(fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK) == 0);
    struct Actions {
      posix_spawn_file_actions_t value;
      Actions() { require(posix_spawn_file_actions_init(&value) == 0); }
      ~Actions() { posix_spawn_file_actions_destroy(&value); }
    } actions;
    struct Attributes {
      posix_spawnattr_t value;
      Attributes() { require(posix_spawnattr_init(&value) == 0); }
      ~Attributes() { posix_spawnattr_destroy(&value); }
    } attributes;
    require(posix_spawn_file_actions_adddup2(&actions.value, childInput.value, STDIN_FILENO) == 0);
    require(posix_spawn_file_actions_adddup2(&actions.value, childOutput.value, STDOUT_FILENO) == 0);
    require(posix_spawn_file_actions_adddup2(&actions.value, errors.value, STDERR_FILENO) == 0);
    require(posix_spawn_file_actions_addchdir_np(&actions.value, "/") == 0);
    sigset_t mask, defaults;
    sigemptyset(&mask);
    sigemptyset(&defaults);
    for (int signal : {SIGINT, SIGTERM, SIGPIPE, SIGHUP}) sigaddset(&defaults, signal);
    require(posix_spawnattr_setsigmask(&attributes.value, &mask) == 0);
    require(posix_spawnattr_setsigdefault(&attributes.value, &defaults) == 0);
    require(posix_spawnattr_setflags(&attributes.value, POSIX_SPAWN_START_SUSPENDED | POSIX_SPAWN_CLOEXEC_DEFAULT |
                                    POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF) == 0);
    std::vector<char*> env;
    for (const auto& entry : environment) env.push_back(const_cast<char*>(entry.c_str()));
    env.push_back(nullptr);
    char mode[] = "--craft-hub-native-identity-recipient";
    char* args[] = {const_cast<char*>(executable.c_str()), mode, nullptr};
    require(posix_spawn(&pid_, executable.c_str(), &actions.value, &attributes.value, args, env.data()) == 0);
    try {
      authenticate(pid_);
      require(!status().has_value());
      require(kill(pid_, SIGCONT) == 0);
    } catch (...) {
      close();
      throw;
    }
  }
  ~OwnedProcess() { close(); }
  pid_t pid() const { return pid_; }
  std::optional<int> status() {
    if (pid_ < 0) return exit_.value_or(-1);
    int state = 0;
    const pid_t result = waitpid(pid_, &state, WNOHANG);
    if (result == 0 || (result < 0 && errno == EINTR)) return std::nullopt;
    // An externally reaped child cannot be used again; never signal a potentially reused PID.
    exit_ = result == pid_ ? (WIFEXITED(state) ? WEXITSTATUS(state) : 128 + WTERMSIG(state)) : -1;
    pid_ = -1;
    return exit_;
  }
  std::optional<std::vector<uint8_t>> read() {
    require(output_.value >= 0);
    std::vector<uint8_t> bytes(16 * 1024);
    const ssize_t count = ::read(output_.value, bytes.data(), bytes.size());
    if (count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) return std::nullopt;
    require(count >= 0);
    bytes.resize(static_cast<size_t>(count));
    return bytes; // Empty means EOF, null means not yet readable.
  }
  size_t write(const void* bytes, size_t size) {
    require(input_.value >= 0 && size <= 64 * 1024 + 1);
    const ssize_t count = ::write(input_.value, bytes, size);
    if (count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK)) return 0;
    require(count >= 0);
    return static_cast<size_t>(count);
  }
  void end() { input_.reset(); }
  void close() {
    input_.reset();
    output_.reset();
    if (pid_ < 0 || status().has_value()) return;
    const pid_t owned = pid_;
    pid_ = -1;
    exit_ = -1;
    kill(owned, SIGKILL);
    // Reap only our unreaped child, without blocking Electron's UI thread on process teardown.
    dispatch_async_f(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), reinterpret_cast<void*>(static_cast<intptr_t>(owned)), [](void* context) {
      const auto child = static_cast<pid_t>(reinterpret_cast<intptr_t>(context));
      while (waitpid(child, nullptr, 0) < 0 && errno == EINTR) {}
    });
  }
};
} // namespace craft_identity
