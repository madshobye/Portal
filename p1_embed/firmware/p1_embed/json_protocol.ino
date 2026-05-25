#include <Arduino.h>
#include "p1_embed_firmware.h"

static bool jsonIsWs(char c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

static const char* jsonSkipWs(const char* p) {
  while (p && *p && jsonIsWs(*p)) p++;
  return p;
}

static bool jsonParseQuoted(const char*& p, String& out) {
  out = "";
  p = jsonSkipWs(p);
  if (!p || *p != '"') return false;
  p++;
  while (*p) {
    char c = *p++;
    if (c == '"') return true;
    if (c == '\\') {
      char e = *p++;
      if (!e) return false;
      switch (e) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        default: out += e; break;
      }
    } else {
      out += c;
    }
  }
  return false;
}

static const char* jsonSkipStringRaw(const char* p) {
  p = jsonSkipWs(p);
  if (!p || *p != '"') return p;
  p++;
  while (*p) {
    char c = *p++;
    if (c == '\\') {
      if (*p) p++;
      continue;
    }
    if (c == '"') return p;
  }
  return p;
}

static const char* jsonSkipValueRaw(const char* p) {
  p = jsonSkipWs(p);
  if (!p || !*p) return p;

  if (*p == '"') return jsonSkipStringRaw(p);

  if (*p == '{') {
    p++;
    while (*p) {
      p = jsonSkipWs(p);
      if (*p == '}') return p + 1;
      if (*p != '"') return p;
      p = jsonSkipStringRaw(p);
      p = jsonSkipWs(p);
      if (*p != ':') return p;
      p = jsonSkipValueRaw(p + 1);
      p = jsonSkipWs(p);
      if (*p == ',') {
        p++;
        continue;
      }
      if (*p == '}') return p + 1;
      return p;
    }
    return p;
  }

  if (*p == '[') {
    p++;
    while (*p) {
      p = jsonSkipWs(p);
      if (*p == ']') return p + 1;
      p = jsonSkipValueRaw(p);
      p = jsonSkipWs(p);
      if (*p == ',') {
        p++;
        continue;
      }
      if (*p == ']') return p + 1;
      return p;
    }
    return p;
  }

  while (*p && *p != ',' && *p != '}' && *p != ']') p++;
  return p;
}

static bool jsonTokenIsArrayIndex(const String& token, int& indexOut) {
  if (!token.length()) return false;
  long value = 0;
  for (size_t i = 0; i < token.length(); i++) {
    char c = token[i];
    if (c < '0' || c > '9') return false;
    value = (value * 10) + (c - '0');
    if (value > 32767) return false;
  }
  indexOut = (int)value;
  return true;
}

static const char* jsonFindObjectPathKey(const char* objectStart, const String& key) {
  const char* p = jsonSkipWs(objectStart);
  if (!p || *p != '{') return nullptr;
  p++;

  while (*p) {
    p = jsonSkipWs(p);
    if (*p == '}') return nullptr;
    String foundKey;
    if (!jsonParseQuoted(p, foundKey)) return nullptr;
    p = jsonSkipWs(p);
    if (*p != ':') return nullptr;
    const char* value = jsonSkipWs(p + 1);
    if (foundKey == key) return value;
    p = jsonSkipValueRaw(value);
    p = jsonSkipWs(p);
    if (*p == ',') {
      p++;
      continue;
    }
    if (*p == '}') return nullptr;
    return nullptr;
  }
  return nullptr;
}

static const char* jsonFindArrayPathIndex(const char* arrayStart, int targetIndex) {
  const char* p = jsonSkipWs(arrayStart);
  if (!p || *p != '[' || targetIndex < 0) return nullptr;
  p++;

  int index = 0;
  while (*p) {
    p = jsonSkipWs(p);
    if (*p == ']') return nullptr;
    const char* value = p;
    if (index == targetIndex) return value;
    p = jsonSkipValueRaw(value);
    p = jsonSkipWs(p);
    if (*p == ',') {
      p++;
      index++;
      continue;
    }
    if (*p == ']') return nullptr;
    return nullptr;
  }
  return nullptr;
}

static String jsonValueToString(const char* valueStart, bool* okOut) {
  if (okOut) *okOut = false;
  const char* p = jsonSkipWs(valueStart);
  if (!p || !*p) return "";

  if (*p == '"') {
    String out;
    const char* q = p;
    if (!jsonParseQuoted(q, out)) return "";
    if (okOut) *okOut = true;
    return out;
  }

  const char* end = jsonSkipValueRaw(p);
  while (end > p && jsonIsWs(end[-1])) end--;
  if (end <= p) return "";

  if (okOut) *okOut = true;
  return String(p).substring(0, end - p);
}

static const char* jsonFindKeyAnywhere(const char* json, const char* key) {
  if (!json || !key || !key[0]) return nullptr;
  const size_t keyLen = strlen(key);
  const char* p = json;
  while (*p) {
    if (*p != '"') {
      p++;
      continue;
    }

    const char* q = p + 1;
    bool escaped = false;
    size_t matched = 0;
    bool exact = true;
    while (*q) {
      char c = *q++;
      if (escaped) {
        escaped = false;
        exact = false;
        continue;
      }
      if (c == '\\') {
        escaped = true;
        continue;
      }
      if (c == '"') break;
      if (matched < keyLen && c == key[matched]) matched++;
      else exact = false;
    }

    if (exact && matched == keyLen && q[-1] == '"') {
      const char* after = jsonSkipWs(q);
      if (after && *after == ':') return jsonSkipWs(after + 1);
    }
    p = q;
  }
  return nullptr;
}

bool jsonGetString(const char* json, const char* key, String& out) {
  const char* p = jsonFindKeyAnywhere(json, key);
  if (!p) return false;
  return jsonParseQuoted(p, out);
}

bool jsonGetBool(const char* json, const char* key, bool& out) {
  const char* p = jsonFindKeyAnywhere(json, key);
  if (!p) return false;
  p = jsonSkipWs(p);
  if (strncmp(p, "true", 4) == 0) {
    out = true;
    return true;
  }
  if (strncmp(p, "false", 5) == 0) {
    out = false;
    return true;
  }
  return false;
}

bool jsonGetInt(const char* json, const char* key, int& out) {
  const char* p = jsonFindKeyAnywhere(json, key);
  if (!p) return false;
  p = jsonSkipWs(p);
  char* end = nullptr;
  long value = strtol(p, &end, 10);
  if (end == p) return false;
  out = (int)value;
  return true;
}

static String jsonEscape(const String& s) {
  String out;
  out.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if ((uint8_t)c < 0x20) out += ' ';
        else out += c;
        break;
    }
  }
  return out;
}

String jsonString(const String& s) {
  return String("\"") + jsonEscape(s) + "\"";
}

String jsonPathGetRaw(const String& json, const String& path, bool* foundOut) {
  if (foundOut) *foundOut = false;
  if (!json.length() || !path.length()) return "";

  const char* current = jsonSkipWs(json.c_str());
  int parts = 0;
  int start = 0;

  while (start <= (int)path.length()) {
    int dot = path.indexOf('.', start);
    String token = dot >= 0 ? path.substring(start, dot) : path.substring(start);
    token.trim();
    if (!token.length() || parts++ >= P1_EMBED_JSON_PATH_MAX_PARTS) return "";

    current = jsonSkipWs(current);
    if (!current || !*current) return "";

    int arrayIndex = -1;
    if (*current == '[' && jsonTokenIsArrayIndex(token, arrayIndex)) {
      current = jsonFindArrayPathIndex(current, arrayIndex);
    } else if (*current == '{') {
      current = jsonFindObjectPathKey(current, token);
    } else {
      return "";
    }
    if (!current) return "";

    if (dot < 0) {
      bool ok = false;
      String out = jsonValueToString(current, &ok);
      if (foundOut) *foundOut = ok;
      return ok ? out : "";
    }
    start = dot + 1;
  }

  return "";
}

bool jsonPathHas(const String& json, const String& path) {
  bool found = false;
  jsonPathGetRaw(json, path, &found);
  return found;
}

String jsonPairString(const String& key, const String& value) {
  return jsonString(key) + ":" + jsonString(value);
}

String jsonPairRaw(const String& key, const String& rawValue) {
  String raw = rawValue;
  raw.trim();
  if (!raw.length()) raw = "null";
  return jsonString(key) + ":" + raw;
}

String jsonPairIntValue(const String& key, int value) {
  return jsonString(key) + ":" + String(value);
}

String jsonPairFloatValue(const String& key, float value, int decimals) {
  decimals = constrain(decimals, 0, 6);
  return jsonString(key) + ":" + String(value, decimals);
}

String jsonPairBoolValue(const String& key, bool value) {
  return jsonString(key) + ":" + String(value ? "true" : "false");
}

String jsonBuildObject(const String& fields) {
  String out = fields;
  out.trim();
  if (out.startsWith("{") && out.endsWith("}")) return out;
  return String("{") + out + "}";
}
