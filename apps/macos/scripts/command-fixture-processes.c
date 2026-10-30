#include <inttypes.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>

static void json_string(const char *text) {
  putchar('"');
  for (const unsigned char *cursor = (const unsigned char *)text; *cursor; cursor++) {
    if (*cursor == '"' || *cursor == '\\') printf("\\%c", *cursor);
    else if (*cursor < 32) printf("\\u%04x", *cursor);
    else putchar(*cursor);
  }
  putchar('"');
}

/* Read-only kernel identities, including the actual executable and microsecond birth time. */
int main(void) {
  int bytes = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0);
  if (bytes <= 0) return EXIT_FAILURE;
  bytes += (int)(256 * sizeof(pid_t));
  pid_t *pids = calloc(1, (size_t)bytes);
  if (!pids) return EXIT_FAILURE;
  int received = proc_listpids(PROC_ALL_PIDS, 0, pids, bytes);
  if (received <= 0) { free(pids); return EXIT_FAILURE; }
  int emitted = 0;
  putchar('[');
  for (int index = 0; index < received / (int)sizeof(pid_t); index++) {
    if (pids[index] <= 0) continue;
    struct proc_bsdinfo info = {0};
    char path[PROC_PIDPATHINFO_MAXSIZE] = {0};
    if (proc_pidinfo(pids[index], PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)) continue;
    if (proc_pidpath(pids[index], path, sizeof(path)) <= 0) continue;
    if (emitted++) putchar(',');
    printf("{\"pid\":%u,\"parent\":%u,\"startedAt\":\"%" PRIu64 ".%06" PRIu64 "\",\"executable\":",
           info.pbi_pid, info.pbi_ppid, info.pbi_start_tvsec, info.pbi_start_tvusec);
    json_string(path);
    putchar('}');
  }
  puts("]");
  free(pids);
  return EXIT_SUCCESS;
}
