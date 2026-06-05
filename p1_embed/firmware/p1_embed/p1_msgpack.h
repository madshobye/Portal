#pragma once

#include <Arduino.h>

enum P1EventFieldType : uint8_t {
  P1_FIELD_STRING,
  P1_FIELD_INT,
  P1_FIELD_UINT,
  P1_FIELD_BOOL,
  P1_FIELD_RAW_JSON
};

struct P1StringView {
  const char* data;
  size_t len;

  bool empty() const { return !data || len == 0; }
};

enum P1ProtocolReplyMode : uint8_t {
  P1_REPLY_MSGPACK,
  P1_REPLY_JSON
};

enum P1ProtocolSource : uint8_t {
  P1_PROTOCOL_SOURCE_SERIAL,
  P1_PROTOCOL_SOURCE_WEBSOCKET,
  P1_PROTOCOL_SOURCE_MQTT,
  P1_PROTOCOL_SOURCE_WEBRTC
};

struct P1FrameView {
  const uint8_t* data = nullptr;
  size_t len = 0;
  uint32_t count = 0;
  uint32_t frameType = 0;
  uint32_t id = 0;
  uint32_t op = 0;
  size_t argsOffset = 0;
};

struct P1EventField {
  const char* key;
  P1EventFieldType type;
  const char* stringValue;
  int32_t intValue;
  uint32_t uintValue;
  bool boolValue;
};

inline P1EventField p1FieldString(const char* key, const char* value) {
  return {key, P1_FIELD_STRING, value ? value : "", 0, 0, false};
}

inline P1EventField p1FieldString(const char* key, const String& value) {
  return {key, P1_FIELD_STRING, value.c_str(), 0, 0, false};
}

inline P1EventField p1FieldInt(const char* key, int32_t value) {
  return {key, P1_FIELD_INT, nullptr, value, 0, false};
}

inline P1EventField p1FieldUInt(const char* key, uint32_t value) {
  return {key, P1_FIELD_UINT, nullptr, 0, value, false};
}

inline P1EventField p1FieldBool(const char* key, bool value) {
  return {key, P1_FIELD_BOOL, nullptr, 0, 0, value};
}

inline P1EventField p1FieldRawJson(const char* key, const String& value) {
  return {key, P1_FIELD_RAW_JSON, value.c_str(), 0, 0, false};
}

// Small P1E-only MessagePack subset. It avoids a generic DOM/object tree and
// writes directly into caller-owned buffers.
struct P1MsgPackWriter {
  uint8_t* data;
  size_t capacity;
  size_t length;
  bool ok;

  P1MsgPackWriter(uint8_t* out, size_t cap) : data(out), capacity(cap), length(0), ok(out != nullptr) {}

  bool writeByte(uint8_t value) {
    if (!ok || length >= capacity) {
      ok = false;
      return false;
    }
    data[length++] = value;
    return true;
  }

  bool writeRaw(const void* src, size_t len) {
    if (!ok || !src || length + len > capacity) {
      ok = false;
      return false;
    }
    memcpy(data + length, src, len);
    length += len;
    return true;
  }

  bool writeArray(uint32_t count) {
    if (count <= 15) return writeByte(0x90 | count);
    if (count <= 0xffff) return writeByte(0xdc) && writeByte(count >> 8) && writeByte(count);
    return false;
  }

  bool writeMap(uint32_t count) {
    if (count <= 15) return writeByte(0x80 | count);
    if (count <= 0xffff) return writeByte(0xde) && writeByte(count >> 8) && writeByte(count);
    return false;
  }

  bool writeBool(bool value) { return writeByte(value ? 0xc3 : 0xc2); }
  bool writeNil() { return writeByte(0xc0); }

  bool writeUInt(uint32_t value) {
    if (value <= 0x7f) return writeByte(value);
    if (value <= 0xff) return writeByte(0xcc) && writeByte(value);
    if (value <= 0xffff) return writeByte(0xcd) && writeByte(value >> 8) && writeByte(value);
    return writeByte(0xce) && writeByte(value >> 24) && writeByte(value >> 16) && writeByte(value >> 8) && writeByte(value);
  }

  bool writeInt(int32_t value) {
    if (value >= 0) return writeUInt((uint32_t)value);
    if (value >= -32) return writeByte(0xe0 | (uint8_t)(value + 32));
    if (value >= -128) return writeByte(0xd0) && writeByte((uint8_t)value);
    if (value >= -32768) return writeByte(0xd1) && writeByte((uint16_t)value >> 8) && writeByte((uint16_t)value);
    return writeByte(0xd2) && writeByte((uint32_t)value >> 24) && writeByte((uint32_t)value >> 16) &&
           writeByte((uint32_t)value >> 8) && writeByte((uint32_t)value);
  }

  bool writeFloat(float value) {
    union {
      float f;
      uint32_t u;
    } v;
    v.f = value;
    return writeByte(0xca) && writeByte(v.u >> 24) && writeByte(v.u >> 16) && writeByte(v.u >> 8) && writeByte(v.u);
  }

  bool writeString(const char* value) {
    if (!value) value = "";
    const size_t len = strlen(value);
    if (len <= 31) return writeByte(0xa0 | len) && writeRaw(value, len);
    if (len <= 0xff) return writeByte(0xd9) && writeByte(len) && writeRaw(value, len);
    if (len <= 0xffff) return writeByte(0xda) && writeByte(len >> 8) && writeByte(len) && writeRaw(value, len);
    return false;
  }

  bool writeString(const String& value) {
    const size_t len = value.length();
    if (len <= 31) return writeByte(0xa0 | len) && writeRaw(value.c_str(), len);
    if (len <= 0xff) return writeByte(0xd9) && writeByte(len) && writeRaw(value.c_str(), len);
    if (len <= 0xffff) return writeByte(0xda) && writeByte(len >> 8) && writeByte(len) && writeRaw(value.c_str(), len);
    return false;
  }

  bool writeBin(const uint8_t* value, size_t len) {
    if (!value && len) return false;
    if (len <= 0xff) return writeByte(0xc4) && writeByte(len) && writeRaw(value, len);
    if (len <= 0xffff) return writeByte(0xc5) && writeByte(len >> 8) && writeByte(len) && writeRaw(value, len);
    return false;
  }
};

struct P1MsgPackReader {
  const uint8_t* data;
  size_t length;
  size_t offset;

  P1MsgPackReader(const uint8_t* in, size_t len) : data(in), length(len), offset(0) {}

  bool readByte(uint8_t& value) {
    if (!data || offset >= length) return false;
    value = data[offset++];
    return true;
  }

  bool readArray(uint32_t& count) {
    uint8_t b = 0;
    if (!readByte(b)) return false;
    if ((b & 0xf0) == 0x90) {
      count = b & 0x0f;
      return true;
    }
    if (b == 0xdc && offset + 2 <= length) {
      count = (uint32_t(data[offset]) << 8) | data[offset + 1];
      offset += 2;
      return true;
    }
    return false;
  }

  bool readUInt(uint32_t& value) {
    uint8_t b = 0;
    if (!readByte(b)) return false;
    if (b <= 0x7f) {
      value = b;
      return true;
    }
    if (b == 0xcc && offset + 1 <= length) {
      value = data[offset++];
      return true;
    }
    if (b == 0xcd && offset + 2 <= length) {
      value = (uint32_t(data[offset]) << 8) | data[offset + 1];
      offset += 2;
      return true;
    }
    if (b == 0xce && offset + 4 <= length) {
      value = (uint32_t(data[offset]) << 24) | (uint32_t(data[offset + 1]) << 16) |
              (uint32_t(data[offset + 2]) << 8) | data[offset + 3];
      offset += 4;
      return true;
    }
    return false;
  }

  bool readBool(bool& value) {
    uint8_t b = 0;
    if (!readByte(b)) return false;
    if (b == 0xc2) {
      value = false;
      return true;
    }
    if (b == 0xc3) {
      value = true;
      return true;
    }
    return false;
  }

  bool readString(String& value) {
    P1StringView view;
    if (!readStringView(view)) return false;
    value = "";
    value.reserve(view.len);
    for (size_t i = 0; i < view.len; i++) value += view.data[i];
    return true;
  }

  bool readStringView(P1StringView& value) {
    value = {nullptr, 0};
    uint8_t b = 0;
    if (!readByte(b)) return false;
    size_t len = 0;
    if ((b & 0xe0) == 0xa0) {
      len = b & 0x1f;
    } else if (b == 0xd9) {
      uint8_t size = 0;
      if (!readByte(size)) return false;
      len = size;
    } else if (b == 0xda) {
      if (offset + 2 > length) return false;
      len = (size_t(data[offset]) << 8) | data[offset + 1];
      offset += 2;
    } else {
      return false;
    }
    if (offset + len > length) return false;
    value = {reinterpret_cast<const char*>(data + offset), len};
    offset += len;
    return true;
  }

  bool readBin(const uint8_t*& value, size_t& len) {
    uint8_t b = 0;
    if (!readByte(b)) return false;
    if (b == 0xc4) {
      uint8_t size = 0;
      if (!readByte(size)) return false;
      len = size;
    } else if (b == 0xc5) {
      if (offset + 2 > length) return false;
      len = (size_t(data[offset]) << 8) | data[offset + 1];
      offset += 2;
    } else {
      return false;
    }
    if (offset + len > length) return false;
    value = data + offset;
    offset += len;
    return true;
  }
};
