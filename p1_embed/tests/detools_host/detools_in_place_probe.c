#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../firmware/p1_embed_updater/src/detools/detools.h"

static int g_step = 0;

struct host_flash_t {
  FILE *memory;
  FILE *patch;
  size_t patch_size;
  size_t patch_offset;
  size_t erase_size;
};

static int step_set(void *arg, int step) {
  (void)arg;
  g_step = step;
  return 0;
}

static int step_get(void *arg, int *step) {
  (void)arg;
  if (!step) return -1;
  *step = g_step;
  return 0;
}

static int copy_and_pad_memory(const char *from_path, const char *memory_path, size_t memory_size) {
  FILE *from = fopen(from_path, "rb");
  if (!from) {
    fprintf(stderr, "open from failed: %s: %s\n", from_path, strerror(errno));
    return 2;
  }

  FILE *memory = fopen(memory_path, "wb");
  if (!memory) {
    fprintf(stderr, "open memory failed: %s: %s\n", memory_path, strerror(errno));
    fclose(from);
    return 2;
  }

  uint8_t buf[4096];
  size_t total = 0;
  while (1) {
    size_t got = fread(buf, 1, sizeof(buf), from);
    if (got > 0) {
      if (total + got > memory_size) {
        fprintf(stderr, "from image exceeds memory size\n");
        fclose(from);
        fclose(memory);
        return 3;
      }
      if (fwrite(buf, 1, got, memory) != got) {
        fprintf(stderr, "write memory failed: %s\n", strerror(errno));
        fclose(from);
        fclose(memory);
        return 2;
      }
      total += got;
    }
    if (got != sizeof(buf)) {
      if (ferror(from)) {
        fprintf(stderr, "read from failed: %s\n", strerror(errno));
        fclose(from);
        fclose(memory);
        return 2;
      }
      break;
    }
  }

  memset(buf, 0xff, sizeof(buf));
  while (total < memory_size) {
    size_t want = memory_size - total;
    if (want > sizeof(buf)) want = sizeof(buf);
    if (fwrite(buf, 1, want, memory) != want) {
      fprintf(stderr, "pad memory failed: %s\n", strerror(errno));
      fclose(from);
      fclose(memory);
      return 2;
    }
    total += want;
  }

  fclose(from);
  fclose(memory);
  return 0;
}

static int compare_prefix(const char *memory_path, const char *to_path) {
  FILE *memory = fopen(memory_path, "rb");
  if (!memory) {
    fprintf(stderr, "open memory compare failed: %s: %s\n", memory_path, strerror(errno));
    return 2;
  }

  FILE *to = fopen(to_path, "rb");
  if (!to) {
    fprintf(stderr, "open target failed: %s: %s\n", to_path, strerror(errno));
    fclose(memory);
    return 2;
  }

  uint8_t a[4096];
  uint8_t b[4096];
  size_t offset = 0;
  int rc = 0;

  while (1) {
    size_t got_b = fread(b, 1, sizeof(b), to);
    if (got_b > 0) {
      size_t got_a = fread(a, 1, got_b, memory);
      if (got_a != got_b) {
        fprintf(stderr, "memory ended early at offset=%zu\n", offset);
        rc = 4;
        break;
      }
      if (memcmp(a, b, got_b) != 0) {
        size_t i;
        for (i = 0; i < got_b; i++) {
          if (a[i] != b[i]) break;
        }
        fprintf(stderr, "mismatch at offset=%zu actual=%02x expected=%02x\n", offset + i, a[i], b[i]);
        rc = 4;
        break;
      }
      offset += got_b;
    }
    if (got_b != sizeof(b)) {
      if (ferror(to)) {
        fprintf(stderr, "read target failed: %s\n", strerror(errno));
        rc = 2;
      }
      break;
    }
  }

  fclose(memory);
  fclose(to);
  if (rc == 0) {
    printf("compare ok bytes=%zu\n", offset);
  }
  return rc;
}

static int file_size(const char *path, size_t *size) {
  FILE *file = fopen(path, "rb");
  if (!file) {
    fprintf(stderr, "open size failed: %s: %s\n", path, strerror(errno));
    return 2;
  }
  if (fseek(file, 0, SEEK_END) != 0) {
    fprintf(stderr, "seek size failed: %s\n", strerror(errno));
    fclose(file);
    return 2;
  }
  long value = ftell(file);
  if (value < 0) {
    fprintf(stderr, "tell size failed: %s\n", strerror(errno));
    fclose(file);
    return 2;
  }
  fclose(file);
  *size = (size_t)value;
  return 0;
}

static int host_mem_read(void *arg, void *dst, uintptr_t src, size_t size) {
  struct host_flash_t *ctx = (struct host_flash_t *)arg;
  if (!ctx || !ctx->memory || !dst) return -DETOOLS_IO_FAILED;
  if (fseek(ctx->memory, (long)src, SEEK_SET) != 0) return -DETOOLS_IO_FAILED;
  if (size > 0 && fread(dst, size, 1, ctx->memory) != 1) return -DETOOLS_IO_FAILED;
  return 0;
}

static int host_mem_write(void *arg, uintptr_t dst, void *src, size_t size) {
  struct host_flash_t *ctx = (struct host_flash_t *)arg;
  if (!ctx || !ctx->memory || !src) return -DETOOLS_IO_FAILED;
  if (fseek(ctx->memory, (long)dst, SEEK_SET) != 0) return -DETOOLS_IO_FAILED;
  if (size > 0 && fwrite(src, size, 1, ctx->memory) != 1) return -DETOOLS_IO_FAILED;
  return 0;
}

static int host_mem_erase(void *arg, uintptr_t addr, size_t size) {
  struct host_flash_t *ctx = (struct host_flash_t *)arg;
  if (!ctx || !ctx->memory) return -DETOOLS_IO_FAILED;
  if (ctx->erase_size > 0 && ((addr % ctx->erase_size) != 0 || (size % ctx->erase_size) != 0)) {
    fprintf(stderr,
            "erase alignment failed addr=%lu size=%zu erase_size=%zu step=%d\n",
            (unsigned long)addr,
            size,
            ctx->erase_size,
            g_step);
    return -DETOOLS_IO_FAILED;
  }
  if (fseek(ctx->memory, (long)addr, SEEK_SET) != 0) return -DETOOLS_IO_FAILED;
  uint8_t buf[4096];
  memset(buf, 0xff, sizeof(buf));
  while (size > 0) {
    size_t chunk = size > sizeof(buf) ? sizeof(buf) : size;
    if (fwrite(buf, chunk, 1, ctx->memory) != 1) return -DETOOLS_IO_FAILED;
    size -= chunk;
  }
  return 0;
}

static int host_patch_read(void *arg, uint8_t *dst, size_t size) {
  struct host_flash_t *ctx = (struct host_flash_t *)arg;
  if (!ctx || !ctx->patch || !dst || ctx->patch_offset + size > ctx->patch_size) {
    return -DETOOLS_IO_FAILED;
  }
  if (size > 0 && fread(dst, size, 1, ctx->patch) != 1) return -DETOOLS_IO_FAILED;
  ctx->patch_offset += size;
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 6 && argc != 7) {
    fprintf(stderr, "usage: %s <from.bin> <to.bin> <patch.bin> <memory.bin> <memory-size> [erase-size]\n", argv[0]);
    return 2;
  }

  const char *from_path = argv[1];
  const char *to_path = argv[2];
  const char *patch_path = argv[3];
  const char *memory_path = argv[4];
  size_t memory_size = (size_t)strtoull(argv[5], NULL, 0);
  size_t erase_size = argc == 7 ? (size_t)strtoull(argv[6], NULL, 0) : 4096;
  if (memory_size == 0) {
    fprintf(stderr, "invalid memory size\n");
    return 2;
  }

  int rc = copy_and_pad_memory(from_path, memory_path, memory_size);
  if (rc != 0) return rc;

  struct host_flash_t ctx;
  memset(&ctx, 0, sizeof(ctx));
  ctx.memory = fopen(memory_path, "r+b");
  ctx.patch = fopen(patch_path, "rb");
  ctx.erase_size = erase_size;
  if (!ctx.memory || !ctx.patch) {
    fprintf(stderr, "open callback files failed\n");
    if (ctx.memory) fclose(ctx.memory);
    if (ctx.patch) fclose(ctx.patch);
    return 2;
  }
  rc = file_size(patch_path, &ctx.patch_size);
  if (rc != 0) {
    fclose(ctx.memory);
    fclose(ctx.patch);
    return rc;
  }

  int result = detools_apply_patch_in_place_callbacks(host_mem_read,
                                                      host_mem_write,
                                                      host_mem_erase,
                                                      step_set,
                                                      step_get,
                                                      host_patch_read,
                                                      ctx.patch_size,
                                                      &ctx);
  fclose(ctx.memory);
  fclose(ctx.patch);
  if (result < 0) {
    fprintf(stderr, "embedded detools failed code=%d %s step=%d\n", result, detools_error_as_string(result), g_step);
    return 1;
  }

  printf("embedded detools apply ok to_size=%d step=%d\n", result, g_step);
  return compare_prefix(memory_path, to_path);
}
