#include "host-quiescence.hpp"

using namespace craft_identity;
int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      require(argc == 2);
      OwnedProcess legacy(argv[1], {"PATH=/usr/bin:/bin"}, [](pid_t) {});
      auto hosts = otherHostProcesses(getpid(), -1, @"org.example.source-fixture", @"org.example.recipient-fixture");
      require(std::find(hosts.begin(), hosts.end(), legacy.pid()) != hosts.end());
      hosts = otherHostProcesses(getpid(), legacy.pid(), @"org.example.source-fixture", @"org.example.recipient-fixture");
      require(std::find(hosts.begin(), hosts.end(), legacy.pid()) == hosts.end());
      require(!legacy.status().has_value());
      require(legacy.write("finish\n", 7) == 7);
      legacy.end();
      for (int attempt = 0; attempt < 200 && !legacy.status().has_value(); ++attempt) usleep(10000);
      require(legacy.status() == 0);
      puts("Known legacy host detected, exact owned child excluded, unrelated process preserved");
      return 0;
    } catch (...) { fputs("Host quiescence verification failed\n", stderr); return 1; }
  }
}
