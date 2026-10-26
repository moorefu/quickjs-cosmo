#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <cosmo.h>
#include <libc/nt/runtime.h>
#include <libc/calls/state.internal.h>

extern void __real__Exit(int) __attribute__((noreturn));
__static_yoink("qjs_cosmo_process_link");

/* exit() still runs its destructors and flushes stdio before reaching here. */
void __wrap__Exit(int status) {
    /* A simulated vfork must first unwind to its parent on exec failure. */
    if (IsWindows() && !__vforked)
        TerminateThisProcess((uint32_t)status);
    __real__Exit(status);
}
