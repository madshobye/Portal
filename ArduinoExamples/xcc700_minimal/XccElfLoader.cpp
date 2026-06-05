#include "XccElfLoader.h"

#include "esp_heap_caps.h"

namespace {

constexpr uint16_t kElfRelocatable = 1;
constexpr uint16_t kElfMachineXtensa = 94;
constexpr uint32_t kSectionProgBits = 1;
constexpr uint32_t kSectionSymtab = 2;
constexpr uint32_t kSectionStrtab = 3;
constexpr uint32_t kSectionRela = 4;
constexpr uint32_t kSectionNoBits = 8;
constexpr uint32_t kRelXtensaJumpSlot = 4;
constexpr uint32_t kRelXtensaRelative = 5;

struct Section {
  const char *name = "";
  uint32_t type = 0;
  uintptr_t addr = 0;
  uint32_t offset = 0;
  uint32_t size = 0;
  uint32_t entsize = 0;
  uint32_t link = 0;
  uint32_t info = 0;
};

uint16_t read16(const uint8_t *p) {
  return uint16_t(p[0]) | (uint16_t(p[1]) << 8);
}

uint32_t read32(const uint8_t *p) {
  return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) |
         (uint32_t(p[3]) << 24);
}

void write32(uint8_t *p, uintptr_t value) {
  p[0] = uint8_t(value);
  p[1] = uint8_t(value >> 8);
  p[2] = uint8_t(value >> 16);
  p[3] = uint8_t(value >> 24);
}

size_t align4(size_t value) {
  return (value + 3) & ~size_t(3);
}

bool rangeOk(size_t offset, size_t size, size_t total) {
  return offset <= total && size <= total - offset;
}

bool sectionContains(const Section &section, uintptr_t address, size_t width) {
  return address >= section.addr && width <= section.size &&
         address - section.addr <= section.size - width;
}

const XccHostSymbol *findSymbol(const char *name, const XccHostSymbol *symbols,
                                size_t symbolCount) {
  for (size_t i = 0; i < symbolCount; ++i) {
    if (strcmp(name, symbols[i].name) == 0) {
      return symbols + i;
    }
  }
  return nullptr;
}

String sectionNameError(const char *what) {
  String out("missing section: ");
  out += what;
  return out;
}

}  // namespace

XccElfModule::XccElfModule()
    : text_(nullptr),
      data_(nullptr),
      textSize_(0),
      dataSize_(0),
      textAddr_(0),
      rodataAddr_(0),
      rodataSize_(0),
      bssAddr_(0),
      bssSize_(0),
      entry_(nullptr) {}

XccElfModule::~XccElfModule() {
  unload();
}

void XccElfModule::unload() {
  if (text_) {
    heap_caps_free(text_);
  }
  if (data_) {
    heap_caps_free(data_);
  }
  text_ = nullptr;
  data_ = nullptr;
  textSize_ = 0;
  dataSize_ = 0;
  textAddr_ = 0;
  rodataAddr_ = 0;
  rodataSize_ = 0;
  bssAddr_ = 0;
  bssSize_ = 0;
  entry_ = nullptr;
}

void *XccElfModule::mapVirtual(uintptr_t virtualAddress, size_t width) {
  if (text_ && virtualAddress >= textAddr_ && width <= textSize_ &&
      virtualAddress - textAddr_ <= textSize_ - width) {
    return text_ + (virtualAddress - textAddr_);
  }
  if (data_ && virtualAddress >= rodataAddr_ && width <= rodataSize_ &&
      virtualAddress - rodataAddr_ <= rodataSize_ - width) {
    return data_ + (virtualAddress - rodataAddr_);
  }
  if (data_ && virtualAddress >= bssAddr_ && width <= bssSize_ &&
      virtualAddress - bssAddr_ <= bssSize_ - width) {
    return data_ + align4(rodataSize_) + (virtualAddress - bssAddr_);
  }
  return nullptr;
}

XccElfLoadResult XccElfModule::load(const uint8_t *elfData, size_t elfSize,
                                    const XccHostSymbol *symbols,
                                    size_t symbolCount) {
  unload();

  if (!elfData || elfSize < 52) {
    return {false, "ELF too small"};
  }
  if (elfData[0] != 0x7f || elfData[1] != 'E' || elfData[2] != 'L' ||
      elfData[3] != 'F') {
    return {false, "not an ELF file"};
  }
  if (elfData[4] != 1 || elfData[5] != 1) {
    return {false, "only 32-bit little-endian ELF is supported"};
  }
  if (read16(elfData + 16) != kElfRelocatable) {
    return {false, "only ET_REL ELF is supported"};
  }
  if (read16(elfData + 18) != kElfMachineXtensa) {
    return {false, "ELF is not Xtensa"};
  }

  const uintptr_t entryVirtual = read32(elfData + 24);
  const uint32_t shoff = read32(elfData + 32);
  const uint16_t shentsize = read16(elfData + 46);
  const uint16_t shnum = read16(elfData + 48);
  const uint16_t shstrndx = read16(elfData + 50);
  if (shentsize != 40 || shnum == 0 || shstrndx >= shnum) {
    return {false, "unsupported section table"};
  }
  if (!rangeOk(shoff, size_t(shentsize) * shnum, elfSize)) {
    return {false, "section table outside ELF"};
  }

  const uint8_t *sectionHeaders = elfData + shoff;
  const uint8_t *shstr = nullptr;
  uint32_t shstrSize = 0;
  {
    const uint8_t *hdr = sectionHeaders + size_t(shstrndx) * shentsize;
    uint32_t offset = read32(hdr + 16);
    uint32_t size = read32(hdr + 20);
    if (!rangeOk(offset, size, elfSize)) {
      return {false, "section name table outside ELF"};
    }
    shstr = elfData + offset;
    shstrSize = size;
  }

  Section text;
  Section rodata;
  Section bss;
  Section rela;
  Section symtab;
  Section strtab;

  for (uint16_t i = 0; i < shnum; ++i) {
    const uint8_t *hdr = sectionHeaders + size_t(i) * shentsize;
    uint32_t nameOffset = read32(hdr + 0);
    if (nameOffset >= shstrSize) {
      return {false, "section name outside shstrtab"};
    }
    Section section;
    section.name = reinterpret_cast<const char *>(shstr + nameOffset);
    section.type = read32(hdr + 4);
    section.addr = read32(hdr + 12);
    section.offset = read32(hdr + 16);
    section.size = read32(hdr + 20);
    section.link = read32(hdr + 24);
    section.info = read32(hdr + 28);
    section.entsize = read32(hdr + 36);

    if (section.type != kSectionNoBits &&
        !rangeOk(section.offset, section.size, elfSize)) {
      String err("section outside ELF: ");
      err += section.name;
      return {false, err};
    }
    if (strcmp(section.name, ".text") == 0) {
      text = section;
    } else if (strcmp(section.name, ".rodata") == 0) {
      rodata = section;
    } else if (strcmp(section.name, ".bss") == 0) {
      bss = section;
    } else if (strcmp(section.name, ".rela") == 0) {
      rela = section;
    } else if (strcmp(section.name, ".symtab") == 0) {
      symtab = section;
    } else if (strcmp(section.name, ".strtab") == 0) {
      strtab = section;
    }
  }

  if (text.type != kSectionProgBits) {
    return {false, sectionNameError(".text")};
  }
  if (rela.type != kSectionRela) {
    return {false, sectionNameError(".rela")};
  }
  if (symtab.type != kSectionSymtab || symtab.entsize != 16) {
    return {false, sectionNameError(".symtab")};
  }
  if (strtab.type != kSectionStrtab) {
    return {false, sectionNameError(".strtab")};
  }
  if (rodata.type != 0 && rodata.type != kSectionProgBits) {
    return {false, "unsupported .rodata section type"};
  }
  if (bss.type != 0 && bss.type != kSectionNoBits) {
    return {false, "unsupported .bss section type"};
  }

  text_ = static_cast<uint8_t *>(
      heap_caps_malloc(align4(text.size), MALLOC_CAP_INTERNAL | MALLOC_CAP_EXEC | MALLOC_CAP_8BIT));
  if (!text_) {
    return {false, "could not allocate executable memory for .text"};
  }
  textSize_ = text.size;
  textAddr_ = text.addr;
  memcpy(text_, elfData + text.offset, text.size);

  rodataSize_ = rodata.size;
  bssSize_ = bss.size;
  rodataAddr_ = rodata.addr;
  bssAddr_ = bss.addr;
  dataSize_ = align4(rodataSize_) + align4(bssSize_);
  if (dataSize_ > 0) {
    data_ = static_cast<uint8_t *>(
        heap_caps_calloc(1, dataSize_, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
    if (!data_) {
      unload();
      return {false, "could not allocate data memory"};
    }
    if (rodata.size > 0) {
      memcpy(data_, elfData + rodata.offset, rodata.size);
    }
  }

  if (rela.size % 12 != 0) {
    unload();
    return {false, "unexpected relocation entry size"};
  }
  const uint8_t *relaData = elfData + rela.offset;
  const uint8_t *symData = elfData + symtab.offset;
  const uint8_t *stringData = elfData + strtab.offset;
  const size_t symCount = symtab.size / symtab.entsize;

  for (size_t i = 0; i < rela.size / 12; ++i) {
    uintptr_t relocVirtual = read32(relaData + i * 12 + 0);
    uint32_t info = read32(relaData + i * 12 + 4);
    uint32_t type = info & 0xff;
    uint32_t symbolIndex = info >> 8;
    uint8_t *patch = static_cast<uint8_t *>(mapVirtual(relocVirtual, 4));
    if (!patch || !sectionContains(text, relocVirtual, 4)) {
      unload();
      return {false, "relocation target is outside .text"};
    }

    if (type == kRelXtensaRelative) {
      uintptr_t original = read32(patch);
      void *mapped = mapVirtual(original, 1);
      if (!mapped && original != 0) {
        unload();
        return {false, "relative relocation points outside loaded sections"};
      }
      write32(patch, reinterpret_cast<uintptr_t>(mapped));
    } else if (type == kRelXtensaJumpSlot) {
      if (symbolIndex >= symCount) {
        unload();
        return {false, "external symbol index outside symtab"};
      }
      const uint8_t *sym = symData + symbolIndex * symtab.entsize;
      uint32_t nameOffset = read32(sym + 0);
      if (nameOffset >= strtab.size) {
        unload();
        return {false, "external symbol name outside strtab"};
      }
      const char *name = reinterpret_cast<const char *>(stringData + nameOffset);
      const XccHostSymbol *host = findSymbol(name, symbols, symbolCount);
      if (!host) {
        String err("unresolved external symbol: ");
        err += name;
        unload();
        return {false, err};
      }
      write32(patch, host->address);
    } else {
      String err("unsupported relocation type: ");
      err += type;
      unload();
      return {false, err};
    }
  }

  entry_ = reinterpret_cast<int (*)()>(mapVirtual(entryVirtual, 1));
  if (!entry_) {
    unload();
    return {false, "ELF entry point is outside loaded sections"};
  }
  return {true, ""};
}

int XccElfModule::runMain() {
  if (!entry_) {
    return -1;
  }
  return entry_();
}
