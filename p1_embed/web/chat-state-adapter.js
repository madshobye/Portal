export function createChatStateAdapter({
  state,
  projectStateAdapter,
  setProjectSpecification,
} = {}) {
  return {
    getChatBusy: () => Boolean(state.busy),
    setChatBusy: (busy) => {
      state.busy = Boolean(busy);
    },
    setProjectDescription: (value) => projectStateAdapter.setCurrentProjectDescription(value),
    setProjectSpecificationMode: (value) => projectStateAdapter.setCurrentProjectSpecificationMode(value),
    setProjectSpecification,
  };
}
