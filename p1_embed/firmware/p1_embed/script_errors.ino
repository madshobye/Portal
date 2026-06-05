#include <Arduino.h>
#include "p1_embed_firmware.h"

static bool g_scriptErrorHasLast = false;
static char g_scriptErrorPhase[P1_EMBED_SCRIPT_ERROR_PHASE_MAX];
static char g_scriptErrorCode[P1_EMBED_SCRIPT_ERROR_CODE_MAX];
static char g_scriptErrorMessage[P1_EMBED_SCRIPT_ERROR_MESSAGE_MAX];
static char g_scriptErrorDetails[P1_EMBED_SCRIPT_ERROR_DETAILS_MAX];
static uint32_t g_scriptErrorAtMs = 0;
static uint32_t g_scriptErrorCount = 0;
static uint32_t g_scriptErrorLastEmitHash = 0;
static uint32_t g_scriptErrorLastEmitAtMs = 0;

static void scriptErrorCopyText(char* dst, size_t size, const char* src) {
  if (!dst || size == 0) return;
  if (!src) src = "";
  size_t i = 0;
  for (; i + 1 < size && src[i]; i++) dst[i] = src[i];
  dst[i] = 0;
}

static uint32_t scriptErrorHashPart(uint32_t h, const char* value) {
  if (!value) value = "";
  while (*value) {
    h ^= (uint8_t)*value++;
    h *= 16777619u;
  }
  h ^= 0xff;
  h *= 16777619u;
  return h;
}

static size_t scriptErrorStringLength(const char* value) {
  return value ? strlen(value) : 0;
}

const char* scriptErrorWrenchName(int code) {
  switch ((WRError)code) {
    case WR_ERR_None: return "none";
    case WR_ERR_compiler_not_loaded: return "compiler_not_loaded";
    case WR_ERR_function_not_found: return "function_not_found";
    case WR_ERR_lib_function_not_found: return "lib_function_not_found";
    case WR_ERR_hash_not_found: return "hash_not_found";
    case WR_ERR_library_constant_not_loaded: return "library_constant_not_loaded";
    case WR_ERR_unknown_opcode: return "unknown_opcode";
    case WR_ERR_unexpected_EOF: return "unexpected_eof";
    case WR_ERR_unexpected_token: return "unexpected_token";
    case WR_ERR_bad_expression: return "bad_expression";
    case WR_ERR_bad_label: return "bad_label";
    case WR_ERR_statement_expected: return "statement_expected";
    case WR_ERR_unterminated_string_literal: return "unterminated_string_literal";
    case WR_ERR_newline_in_string_literal: return "newline_in_string_literal";
    case WR_ERR_bad_string_escape_sequence: return "bad_string_escape_sequence";
    case WR_ERR_tried_to_load_non_resolvable: return "tried_to_load_non_resolvable";
    case WR_ERR_break_keyword_not_in_looping_structure: return "break_not_in_loop";
    case WR_ERR_continue_keyword_not_in_looping_structure: return "continue_not_in_loop";
    case WR_ERR_expected_while: return "expected_while";
    case WR_ERR_compiler_panic: return "compiler_panic";
    case WR_ERR_constant_redefined: return "constant_redefined";
    case WR_ERR_struct_in_struct: return "struct_in_struct";
    case WR_ERR_var_not_seen_before_label: return "var_not_seen_before_label";
    case WR_ERR_unexpected_export_keyword: return "unexpected_export_keyword";
    case WR_ERR_new_assign_by_label_or_offset_not_both: return "new_assign_by_label_or_offset_not_both";
    case WR_ERR_struct_not_exported: return "struct_not_exported";
    case WR_ERR_empty_parens: return "empty_parens";
    case WR_ERR_blank_variables_cannot_be_initialized: return "blank_variables_cannot_be_initialized";
    case WR_ERR_run_must_be_called_by_itself_first: return "run_must_be_called_by_itself_first";
    case WR_ERR_hash_table_size_exceeded: return "hash_table_size_exceeded";
    case WR_ERR_hash_table_invalid_key: return "hash_table_invalid_key";
    case WR_ERR_wrench_function_not_found: return "wrench_function_not_found";
    case WR_ERR_array_must_be_indexed: return "array_must_be_indexed";
    case WR_ERR_scontext_not_found: return "scontext_not_found";
    case WR_ERR_context_not_yielded: return "context_not_yielded";
    case WR_ERR_cannot_call_function_context_yielded: return "cannot_call_function_context_yielded";
    case WR_ERR_hash_declaration_in_array: return "hash_declaration_in_array";
    case WR_ERR_array_declaration_in_hash: return "array_declaration_in_hash";
    case WR_ERR_stack_overflow: return "stack_overflow";
    case WR_ERR_bad_goto_label: return "bad_goto_label";
    case WR_ERR_bad_goto_location: return "bad_goto_location";
    case WR_ERR_goto_target_not_found: return "goto_target_not_found";
    case WR_ERR_switch_with_no_cases: return "switch_with_no_cases";
    case WR_ERR_switch_case_or_default_expected: return "switch_case_or_default_expected";
    case WR_ERR_switch_construction_error: return "switch_construction_error";
    case WR_ERR_switch_bad_case_hash: return "switch_bad_case_hash";
    case WR_ERR_switch_duplicate_case: return "switch_duplicate_case";
    case WR_ERR_bad_bytecode_CRC: return "bad_bytecode_crc";
    case WR_ERR_execute_function_zero_called_more_than_once: return "execute_function_zero_called_more_than_once";
    case WR_ERR_malloc_failed: return "malloc_failed";
    case WR_ERR_USER_err_out_of_range: return "user_error_out_of_range";
    case WR_ERR_division_by_zero: return "division_by_zero";
    default: return "unknown";
  }
}

void scriptErrorClear() {
  g_scriptErrorHasLast = false;
  g_scriptErrorPhase[0] = 0;
  g_scriptErrorCode[0] = 0;
  g_scriptErrorMessage[0] = 0;
  g_scriptErrorDetails[0] = 0;
  g_scriptErrorAtMs = 0;
  g_scriptErrorLastEmitHash = 0;
  g_scriptErrorLastEmitAtMs = 0;
}

static String scriptErrorBuildJson(const P1ScriptErrorSnapshot& snapshot, bool includeDetails) {
  String out = "{";
  out += "\"hasError\":" + String(snapshot.hasError ? "true" : "false");
  out += ",\"count\":" + String(snapshot.count);
  if (snapshot.hasError) {
    out += ",\"phase\":" + jsonString(snapshot.phase);
    out += ",\"code\":" + jsonString(snapshot.code);
    out += ",\"message\":" + jsonString(snapshot.message);
    out += ",\"atMs\":" + String(snapshot.atMs);
    if (includeDetails && scriptErrorStringLength(snapshot.details)) out += "," + String(snapshot.details);
  }
  out += "}";
  return out;
}

static void scriptErrorStore(const String& phase, const String& code, const String& message, const String& detailFieldsJson) {
  g_scriptErrorHasLast = true;
  scriptErrorCopyText(g_scriptErrorPhase, sizeof(g_scriptErrorPhase), phase.c_str());
  scriptErrorCopyText(g_scriptErrorCode, sizeof(g_scriptErrorCode), code.c_str());
  scriptErrorCopyText(g_scriptErrorMessage, sizeof(g_scriptErrorMessage), message.c_str());
  if (detailFieldsJson.length() < sizeof(g_scriptErrorDetails)) {
    scriptErrorCopyText(g_scriptErrorDetails, sizeof(g_scriptErrorDetails), detailFieldsJson.c_str());
  } else {
    snprintf(g_scriptErrorDetails, sizeof(g_scriptErrorDetails),
             "\"detailsTruncated\":true,\"detailsBytes\":%u",
             (unsigned)detailFieldsJson.length());
  }
  g_scriptErrorAtMs = millis();
  g_scriptErrorCount++;
}

static void scriptErrorEmit(const char* level, const String& phase, const String& code, const String& message) {
  uint32_t emitHash = 2166136261u;
  emitHash = scriptErrorHashPart(emitHash, level);
  emitHash = scriptErrorHashPart(emitHash, phase.c_str());
  emitHash = scriptErrorHashPart(emitHash, code.c_str());
  emitHash = scriptErrorHashPart(emitHash, message.c_str());
  uint32_t now = millis();
  if (emitHash == g_scriptErrorLastEmitHash && now - g_scriptErrorLastEmitAtMs < P1_EMBED_SCRIPT_ERROR_EMIT_REPEAT_MS) {
    return;
  }
  g_scriptErrorLastEmitHash = emitHash;
  g_scriptErrorLastEmitAtMs = now;
  P1EventField fields[] = {
    p1FieldBool("hasError", true),
    p1FieldString("phase", g_scriptErrorPhase),
    p1FieldString("code", g_scriptErrorCode),
    p1FieldString("message", g_scriptErrorMessage),
    p1FieldUInt("atMs", g_scriptErrorAtMs),
    p1FieldUInt("count", g_scriptErrorCount),
  };
  debugEventEmitFields("script.error", level, "script", g_scriptErrorMessage, fields, 6);
}

void scriptErrorSet(const String& phase, const String& code, const String& message, const String& detailFieldsJson) {
  scriptErrorStore(phase, code, message, detailFieldsJson);
  scriptErrorEmit("error", phase, code, message);
  scriptStoreMarkVerificationFailed(code.c_str());
}

void scriptErrorWarn(const String& phase, const String& code, const String& message, const String& detailFieldsJson) {
  scriptErrorStore(phase, code, message, detailFieldsJson);
  scriptErrorEmit("warn", phase, code, message);
}

bool scriptErrorHasLast() {
  return g_scriptErrorHasLast;
}

P1ScriptErrorSnapshot scriptErrorSnapshot() {
  P1ScriptErrorSnapshot snapshot;
  snapshot.hasError = g_scriptErrorHasLast;
  snapshot.phase = g_scriptErrorPhase;
  snapshot.code = g_scriptErrorCode;
  snapshot.message = g_scriptErrorMessage;
  snapshot.details = g_scriptErrorDetails;
  snapshot.atMs = g_scriptErrorAtMs;
  snapshot.count = g_scriptErrorCount;
  return snapshot;
}

String scriptErrorLastCode() {
  return String(g_scriptErrorCode);
}

String scriptErrorLastJson(const P1ScriptErrorSnapshot& snapshot) {
  return scriptErrorBuildJson(snapshot, true);
}

String scriptErrorLastJson() {
  return scriptErrorLastJson(scriptErrorSnapshot());
}

String scriptErrorLastPhase() {
  return String(g_scriptErrorPhase);
}

String scriptErrorLastMessage() {
  return String(g_scriptErrorMessage);
}

String scriptErrorLastDetails() {
  return String(g_scriptErrorDetails);
}

uint32_t scriptErrorLastAtMs() {
  return g_scriptErrorAtMs;
}

uint32_t scriptErrorCount() {
  return g_scriptErrorCount;
}

String scriptErrorSummaryJson(const P1ScriptErrorSnapshot& snapshot) {
  return scriptErrorBuildJson(snapshot, false);
}

String scriptErrorSummaryJson() {
  return scriptErrorSummaryJson(scriptErrorSnapshot());
}
