#include <errno.h>
#include <inttypes.h>
#include <libproc.h>
#include <limits.h>
#include <mach/mach_time.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>

static uint64_t nanoseconds(uint64_t ticks, mach_timebase_info_data_t timebase) {
  __uint128_t result = (__uint128_t)ticks * timebase.numer / timebase.denom;
  return result > UINT64_MAX ? UINT64_MAX : (uint64_t)result;
}

/* libproc CPU times are Mach absolute ticks. Export converted nanoseconds and the conversion used. */
int main(int argc, char **argv) {
  mach_timebase_info_data_t timebase;
  if (mach_timebase_info(&timebase) != KERN_SUCCESS || !timebase.denom) return EXIT_FAILURE;
  int failed = 0;
  printf("{\"cpuUnit\":\"nanoseconds\",\"timebaseNumer\":%u,\"timebaseDenom\":%u,\"samples\":[", timebase.numer, timebase.denom);
  for (int i = 1; i < argc; i++) {
    char *end = NULL;
    errno = 0;
    long parsed = strtol(argv[i], &end, 10);
    if (i > 1) printf(",");
    if (errno || !end || *end || parsed <= 0 || parsed > INT_MAX) {
      printf("{\"error\":\"invalid-pid\"}");
      failed = 1;
      continue;
    }
    struct rusage_info_v4 usage = {0};
    if (proc_pid_rusage((int)parsed, RUSAGE_INFO_V4, (rusage_info_t *)&usage)) {
      printf("{\"pid\":%ld,\"error\":%d}", parsed, errno);
      failed = 1;
      continue;
    }
    printf("{\"pid\":%ld,\"startedAtMachTicks\":\"%" PRIu64 "\","
           "\"cpuUserNs\":%" PRIu64 ",\"cpuSystemNs\":%" PRIu64 ","
           "\"interruptWakeups\":%" PRIu64 ",\"packageIdleWakeups\":%" PRIu64 ","
           "\"physicalFootprintBytes\":%" PRIu64 ",\"residentBytes\":%" PRIu64 "}",
           parsed, usage.ri_proc_start_abstime, nanoseconds(usage.ri_user_time, timebase), nanoseconds(usage.ri_system_time, timebase),
           usage.ri_interrupt_wkups, usage.ri_pkg_idle_wkups, usage.ri_phys_footprint,
           usage.ri_resident_size);
  }
  printf("]}\n");
  return failed ? EXIT_FAILURE : EXIT_SUCCESS;
}
