#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "core.h"
static _Thread_local QCAllocator *current;
typedef union { max_align_t align; struct { QCAllocator owner; void *raw; size_t length; } value; } Header;
QCAllocator *qc_allocator_enter(QCAllocator *next) { QCAllocator *old=current; current=next; return old; }
void qc_allocator_leave(QCAllocator *old) { current=old; }
void *qc_allocate(QCAllocator *owner,size_t length) {
    size_t alignment=_Alignof(Header),extra=sizeof(Header)+alignment-1;
    if (!owner || length>SIZE_MAX-extra) { if (owner) owner->failed=1; return NULL; }
    void *raw=owner->allocate(owner->opaque,extra+length);
    if (!raw) { owner->failed=1; return NULL; }
    Header *header=(void *)(((uintptr_t)raw+alignment-1)&~(uintptr_t)(alignment-1));
    header->value.owner=*owner; header->value.raw=raw; header->value.length=length;
    return header+1;
}
void qc_free(void *data) {
    if (!data) return;
    Header *header=(Header *)data-1;
    header->value.owner.release(header->value.owner.opaque,header->value.raw);
}
/* Partial-link wrapping is restricted to this compression closure. */
void *__wrap_malloc(size_t length) { return qc_allocate(current,length); }
void *__wrap_calloc(size_t count,size_t size) {
    if (count && size>SIZE_MAX/count) { if (current) current->failed=1; return NULL; }
    size_t length=count*size; void *data=qc_allocate(current,length);
    if (data) memset(data,0,length);
    return data;
}
void __wrap_free(void *data) { qc_free(data); }
void *__wrap_realloc(void *data,size_t size) {
    if (!data) return __wrap_malloc(size);
    if (!size) { qc_free(data); return NULL; }
    Header *header=(Header *)data-1;
    void *next=qc_allocate(&header->value.owner,size);
    if (next) { memcpy(next,data,size<header->value.length?size:header->value.length); qc_free(data); }
    return next;
}
