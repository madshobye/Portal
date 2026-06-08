export function buildSpecificationGeneratePrompt(specification, {
  specificationMode,
  specificationModeLabel,
} = {}) {
  return [
    "Specification Generate mode.",
    "Update the current code to match the specification.",
    "Generate a complete P1E Wrench script from the project specification below.",
    "The specification is the source of truth. Existing editor code is only a starting point or reusable material.",
    "If the existing code conflicts with the specification, change the code to match the specification.",
    "Return code_action=\"replace\" and provide complete replacement code.",
    "Also return an updated project_specification that preserves the user's intent and accurately describes the generated code.",
    "",
    `Specification mode: ${specificationModeLabel(specificationMode)}`,
    "",
    "Project specification:",
    specification,
  ].join("\n");
}

export function buildInteractionPriorityInstructions(purpose = "chat") {
  if (purpose === "specification") {
    return [
      "Interaction mode: Specification Generate.",
      "Main task: update the current code to match the specification.",
      "Priority order:",
      "1. The current project specification is the dominant source of truth.",
      "2. Current editor code is the implementation base to revise, not an equal source of intent.",
      "3. Preserve useful existing code structure, names, pins, and stable behavior only when it does not conflict with the specification.",
      "4. If current code conflicts with the specification, change the code to satisfy the specification.",
      "5. Ignore previous chat for intent; it is not included as authority in this mode.",
      "Output requirement: return code_action=\"replace\" with complete code unless the specification is impossible to implement.",
      "The returned project_specification should refine and clarify the specification, not silently change its intent to match old code.",
    ].join("\n");
  }
  return [
    "Interaction mode: Chat.",
    "Priority order:",
    "1. The newest user request is the dominant instruction.",
    "2. Current editor code and current specification are context to edit from.",
    "3. If the user asks for a code change, adjust the code to follow the chat request and update project_specification to match the resulting code.",
    "4. If the user asks only a question, use code_action=\"none\" and keep project_specification unchanged unless an explicit clarification is useful.",
  ].join("\n");
}

export function buildChatInstructions(context) {
  return [
    "You are the P1E Wrench coding assistant inside a browser tool for an ESP32 classic firmware.",
    "Return only JSON matching the requested schema.",
    "Respect the interaction-mode priority rules in the user input. They define whether chat request or project specification is the source of truth.",
    "When producing code, provide a complete Wrench script that can replace the editor contents.",
    "Every generated sketch must start with a short // comment explaining what the sketch does.",
    "When producing code, also provide sketch_name: a short project revision title, 2-5 words and at most 32 characters.",
    "Naming rule: for small iterations, keep the current revision base name and increment its trailing number, such as LED Chase -> LED Chase 2 -> LED Chase 3. For larger reframings, choose a new short descriptive name. Do not invent a random unrelated name when the current name still describes the work. Avoid dates, New Sketch, generic Revision names, and decorative punctuation.",
    "When producing or changing code, also provide project_specification as simple Markdown that matches the resulting code and follows the requested specification_mode.",
    "Project specification rule: describe only the current resulting sketch in concise present tense. Do not write a changelog, transcript, reflection, or iterative phrasing such as now, updated to, changed from, without X, instead of, previously, the user asked, or this revision. If behavior was removed, omit the removed behavior and describe the final behavior.",
    "Use only this Markdown subset in project_specification: # through #### headings, **bold**, *italic*, <u>underline</u>, numbered lists, and bullet lists.",
    "Specification modes: overview means high-level human description; middle means important implementation details without pseudocode; structured means sections like Program, Global values, Setup, and Main loop in Markdown/plain text.",
    "Do not generate a circuit diagram layout. Always return circuit_layout as an empty object. The browser infers the diagram from code and // p1e-circuit comments near pin variables. Add these comments whenever the user's words choose a specific physical part that generic code cannot prove. Use exact component keys such as led, relay, buzzer, servo, largeServo, fan, dcMotor, stepperMotor, ledStrip, neopixelRing, potentiometer, analogMeter, microphone, distanceSensor, analogSensor, digitalSensor, button, touchPad, imu, mp3Player, vl53l0x, uda1334a, ld2410c. If the user says IMU/MPU/gyro/accelerometer, write imu and use wireBegin(SDA, SCL); do not invent an analog IMU data pin. If the user says MP3 player, DFPlayer, or MP3 trigger, write mp3Player; a GPIO trigger/play pin is an output/control wire to the player, not a digitalSensor. If the user says large/big/high-torque servo, write largeServo, never plain servo. If the user says potentiometer/knob/dial, write potentiometer. If the user says GY-VL53L0XV2/Laser ToF, write vl53l0x. If the user says UDA1334A/I2S stereo decoder, write uda1334a. If the user says Hi-Link LD2410C/microwave radar, write ld2410c. If the user says LED string/strip/bar or NeoPixel strip, write ledStrip. Example: var servoPin = 16; // p1e-circuit: IO16 largeServo",
    "When generated code reads a named physical input, add a short ordinary comment immediately before the read, such as // Read the potentiometer. before analogRead(potPin), // Read the microphone. before analogRead(micPin), or // Read the button. before digitalRead(buttonPin). Keep these comments concrete and physical, not generic sensor wording when the part is known.",
    "GPIO rule: pinMode uses firmware constants such as INPUT, OUTPUT, INPUT_PULLUP, and INPUT_PULLDOWN when available. Write pinMode(powerPin, OUTPUT), never pinMode(powerPin, \"OUTPUT\"). digitalWrite should use HIGH/LOW if available or 1/0, never string values.",
    "Declare scratch variables at the top of each function and assign them inside while/if blocks. Avoid new var declarations inside tight loops or nested blocks, especially LED render loops.",
    "When the user asks for a live interface, dashboard, or controls, use the documented firmware-driven UI bindings in a Guino-style lifecycle: declare the interface in a drawUi() function from setup() and on hello, read slider/toggle state with uiGet(), use while (uiPoll()) plus uiEventIs(type, id) for buttons and hello redraw events, update ordinary values with uiUpdate(), and stream every graph/sample with uiPush(). Do not call uiBegin() after every control change.",
    "Prefer setup() and loop(). Keep loop non-blocking where reasonable. Use short delay() only when it is intentional.",
    "Avoid factory reset or destructive device actions. Do not invent firmware bindings beyond the documented P1E bindings.",
    "If the user's request is ambiguous, explain the assumption in reply and notes.",
    "Use warnings only for immediate, concrete risks such as unsafe pins, high current, blocking code, destructive commands, missing credentials, or likely firmware/resource failure.",
    "Do not include generic warnings such as code will be replaced, test before use, or backup your work. Put ordinary caveats in notes, or leave arrays empty.",
    "",
    context,
  ].join("\n");
}

export function buildChatRequestPayload({
  model,
  prompt,
  purpose = "chat",
  context,
  currentCode = "",
  recentLog = [],
  lastError = null,
  deviceInfo = {},
  deviceStatus = {},
  projectSpecification = "",
  specificationMode = "middle",
  naming,
  conversation = [],
  maxOutputTokens = 8000,
  specificationModeLabel,
  specificationModePrompt,
} = {}) {
  const payloadContext = {
    currentCode,
    recentLog,
    lastError,
    deviceInfo,
    deviceStatus,
    projectSpecification,
    specificationMode,
    naming,
    purpose,
    conversation,
  };
  const instructions = buildChatInstructions(context);
  const userInputText = [
    buildInteractionPriorityInstructions(payloadContext.purpose),
    [
      "Current project naming:",
      `Project: ${naming.projectName || "(untitled project)"}`,
      `Current revision: ${naming.currentRevisionName || "(unnamed revision)"}`,
      `Suggested name for a small iteration: ${naming.suggestedSmallIterationName}`,
      `Maximum sketch_name length: ${naming.maxNameChars} characters`,
    ].join("\n"),
    `User request:\n${prompt}`,
    `Current project specification mode:\n${specificationModeLabel(payloadContext.specificationMode)}\n${specificationModePrompt(payloadContext.specificationMode)}`,
    `Current project specification:\n${payloadContext.projectSpecification || "(empty)"}`,
    payloadContext.purpose === "specification"
      ? `Current code to revise. Keep useful structure, names, pins, and working behavior only when they do not conflict with the specification:\n${payloadContext.currentCode || "(empty)"}`
      : "",
    `P1E context JSON:\n${JSON.stringify(payloadContext)}`,
  ].filter(Boolean).join("\n\n");

  const body = {
    model,
    instructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: userInputText,
          },
        ],
      },
    ],
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: "json_schema",
        name: "p1e_wrench_assistant_response",
        strict: false,
        schema: chatResponseSchema(),
      },
    },
  };

  return {
    body,
    instructions,
    payloadContext,
    userInputText,
  };
}

export function chatResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: { type: "string" },
      code: { type: "string" },
      code_action: { type: "string", enum: ["replace", "none"] },
      sketch_name: { type: "string" },
      project_specification: { type: "string" },
      specification_mode: { type: "string", enum: ["overview", "middle", "structured"] },
      notes: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } },
      circuit_layout: {
        type: "object",
        additionalProperties: true,
        properties: {
          version: { type: "string" },
          board: { type: "object", additionalProperties: true },
          components: { type: "array", items: { type: "object", additionalProperties: true } },
          connections: { type: "array", items: { type: "object", additionalProperties: true } },
          assumptions: { type: "array", items: { type: "string" } },
          notes: { type: "array", items: { type: "string" } },
        },
      },
    },
    required: ["reply", "code", "code_action", "sketch_name", "project_specification", "specification_mode", "notes", "warnings", "circuit_layout"],
  };
}

export function chatPromptDebugMarkdown({ model, prompt, instructions, userInputText, payloadContext, body, now = new Date() }) {
  const code = payloadContext.currentCode || "";
  const log = Array.isArray(payloadContext.recentLog) ? payloadContext.recentLog.join("\n") : "";
  const conversation = Array.isArray(payloadContext.conversation)
    ? payloadContext.conversation.map((item, index) => {
      const content = String(item.content || "").trim();
      return `${index + 1}. ${item.role}: ${content}`;
    }).join("\n")
    : "";
  const lastError = payloadContext.lastError ? JSON.stringify(payloadContext.lastError, null, 2) : "none";
  return [
    "# P1E Chat Prompt Debug",
    "",
    `Time: ${now.toISOString()}`,
    `Model: ${model}`,
    "",
    "## User Request",
    "",
    "```text",
    prompt,
    "```",
    "",
    "## Instructions",
    "",
    "```text",
    instructions,
    "```",
    "",
    "## User Input Sent To Model",
    "",
    "```text",
    userInputText,
    "```",
    "",
    "## Current Code",
    "",
    "```wrench",
    code,
    "```",
    "",
    "## Recent Chat History",
    "",
    conversation || "none",
    "",
    "## Last Device Error",
    "",
    "```json",
    lastError,
    "```",
    "",
    "## Recent Log",
    "",
    "```text",
    log || "none",
    "```",
    "",
    "## Full Request Body",
    "",
    "```json",
    JSON.stringify(body, null, 2),
    "```",
  ].join("\n");
}
