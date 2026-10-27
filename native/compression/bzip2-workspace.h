#ifndef QUICKJS_COSMO_BZIP2_WORKSPACE_H
#define QUICKJS_COSMO_BZIP2_WORKSPACE_H
#include "libc/mem/gc.h"
#include "libc/mem/mem.h"
/* These two pinned Nightly files replaced six original fixed work arrays with
   unchecked gc(calloc(...)). Restore bounded automatic storage in this private
   translation unit: no allocator failure or libc GC ownership can escape here.
   The actual codec state and block buffers still use the quota allocator. */
#undef gc
#define gc(pointer) (pointer)
#define calloc(count,size) ({ \
    _Static_assert(__builtin_constant_p(count) && __builtin_constant_p(size) && \
                   (count)>0 && (size)>0 && (count)*(size)<=2064, \
                   "Review changed bzip2 fixed workspace"); \
    __builtin_memset(__builtin_alloca((count)*(size)),0,(count)*(size)); \
})
#endif
