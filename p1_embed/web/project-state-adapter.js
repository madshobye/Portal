export function createProjectStateAdapter({
  state,
  setSketchHistoryTitle = () => {},
} = {}) {
  return {
    getChatMessages: () => state.chatMessages,
    getCurrentProjectCircuit: () => state.currentProjectCircuit,
    getCurrentProjectDescription: () => state.currentProjectDescription,
    getCurrentProjectDescriptionSource: () => state.currentProjectDescriptionSource,
    getCurrentProjectId: () => state.currentProjectId,
    getCurrentProjectSpecificationMode: () => state.currentProjectSpecificationMode,
    getCurrentProjectSpecificationModeSource: () => state.currentProjectSpecificationModeSource,
    getCurrentRevisionId: () => state.currentRevisionId,
    getCurrentSketchName: () => state.currentSketchName,
    getCurrentSketchSaved: () => state.currentSketchSaved,
    getCurrentSketchSource: () => state.currentSketchSource,
    getProjectCache: () => state.projectCache,
    getProjectSelectTimer: () => state.projectSelectTimer,
    getRevisionSelectTimer: () => state.revisionSelectTimer,
    hasCircuitChatLayout: () => Boolean(state.circuitChatLayout),
    setChatMessages: (messages) => {
      state.chatMessages = messages;
    },
    setCircuitChatLayout: (layout) => {
      state.circuitChatLayout = layout;
    },
    setCurrentProjectCircuit: (layout) => {
      state.currentProjectCircuit = layout;
    },
    setCurrentProjectDescription: (value) => {
      state.currentProjectDescription = value;
    },
    setCurrentProjectDescriptionSource: (value) => {
      state.currentProjectDescriptionSource = value;
    },
    setCurrentProjectId: (id) => {
      state.currentProjectId = id;
    },
    setCurrentProjectSpecificationMode: (value) => {
      state.currentProjectSpecificationMode = value;
    },
    setCurrentProjectSpecificationModeSource: (value) => {
      state.currentProjectSpecificationModeSource = value;
    },
    setCurrentRevisionId: (id) => {
      state.currentRevisionId = id;
    },
    setCurrentSketchDirty: (value) => {
      state.currentSketchDirty = value;
    },
    setCurrentSketchName: (value) => {
      state.currentSketchName = value;
    },
    setCurrentSketchSaved: (value) => {
      state.currentSketchSaved = value;
    },
    setCurrentSketchSource: (value) => {
      state.currentSketchSource = value;
    },
    setCurrentSketchVersionName: (value) => {
      state.currentSketchVersionName = value;
    },
    setProjectCache: (projects) => {
      state.projectCache = projects;
    },
    setProjectSelectTimer: (timer) => {
      state.projectSelectTimer = timer;
    },
    setRevisionSelectTimer: (timer) => {
      state.revisionSelectTimer = timer;
    },
    setSketchHistoryTitle,
  };
}
