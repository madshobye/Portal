#include <Arduino.h>
#include "p1_embed_firmware.h"

struct WrenchInboxItem {
  char channel[P1_EMBED_WRENCH_INBOX_CHANNEL_MAX];
  char message[P1_EMBED_WRENCH_INBOX_MESSAGE_MAX];
};

static QueueHandle_t g_wrenchInbox = nullptr;
static volatile uint32_t g_wrenchInboxDrops = 0;

void wrenchInboxBegin() {
  if (!g_wrenchInbox) {
    g_wrenchInbox = xQueueCreate(P1_EMBED_WRENCH_INBOX_DEPTH, sizeof(WrenchInboxItem));
  }
}

bool wrenchInboxPush(const String& channel, const String& message) {
  wrenchInboxBegin();
  if (!g_wrenchInbox) return false;

  WrenchInboxItem item;
  String safeChannel = channel.length() ? channel : "protocol";
  safeChannel.toCharArray(item.channel, sizeof(item.channel));
  message.toCharArray(item.message, sizeof(item.message));

  if (xQueueSend(g_wrenchInbox, &item, 0) != pdTRUE) {
    g_wrenchInboxDrops++;
    scriptErrorWarn("inbox", "inbox_full", "Wrench input inbox is full", "\"drops\":" + String(g_wrenchInboxDrops));
    return false;
  }
  return true;
}

bool wrenchInboxRead(String& channelOut, String& messageOut) {
  channelOut = "";
  messageOut = "";
  if (!g_wrenchInbox) return false;

  WrenchInboxItem item;
  if (xQueueReceive(g_wrenchInbox, &item, 0) != pdTRUE) return false;
  channelOut = String(item.channel);
  messageOut = String(item.message);
  return true;
}

uint32_t wrenchInboxAvailable() {
  if (!g_wrenchInbox) return 0;
  return (uint32_t)uxQueueMessagesWaiting(g_wrenchInbox);
}

uint32_t wrenchInboxDrops() {
  return g_wrenchInboxDrops;
}

void wrenchInboxClear() {
  if (!g_wrenchInbox) return;
  xQueueReset(g_wrenchInbox);
}
