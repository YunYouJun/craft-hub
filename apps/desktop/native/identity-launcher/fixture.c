#include <fcntl.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char** argv) {
  if (argc != 2 || strcmp(argv[1], "--craft-hub-native-identity-recipient") != 0) return 2;
  if (getenv("NODE_OPTIONS") || getenv("NODE_PATH") || getenv("DYLD_INSERT_LIBRARIES")) return 3;
  for (int fd = 3; fd < 1024; ++fd) if (fcntl(fd, F_GETFD) >= 0) return 4;
  char directory[1024];
  if (!getcwd(directory, sizeof(directory)) || strcmp(directory, "/") != 0) return 5;
  puts("owned-private-pipes-ready");
  fflush(stdout);
  char input[32];
  return !fgets(input, sizeof(input), stdin) || strcmp(input, "finish\n") != 0 ? 6 : 0;
}
