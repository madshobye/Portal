const projectControlConfigs = {
  code: {
    connectId: "connect-button",
    newProjectId: "new-sketch-button",
    newRevisionId: "new-revision-button",
    downloadId: "download-code-button",
    projectSelectId: "project-select",
    revisionSelectId: "sketch-history",
    revisionTitle: "New clean revision",
    downloadTitle: "Download project",
  },
  chat: {
    connectId: "chat-connect-button",
    newProjectId: "chat-new-sketch-button",
    newRevisionId: "chat-new-revision-button",
    downloadId: "chat-download-code-button",
    projectSelectId: "generative-project-select",
    revisionSelectId: "generative-revision-select",
    revisionTitle: "New clean revision",
    downloadTitle: "Download project",
  },
  circuit: {
    connectId: "circuit-connect-button",
    newProjectId: "circuit-new-sketch-button",
    newRevisionId: "circuit-new-revision-button",
    downloadId: "circuit-download-code-button",
    projectSelectId: "circuit-project-select",
    revisionSelectId: "circuit-revision-select",
    revisionTitle: "New revision",
    downloadTitle: "Download project code",
  },
};

function iconButton({ id, className = "button icon-buttonish", title, icon, disabled = false }) {
  const disabledAttribute = disabled ? " disabled" : "";
  return `<button id="${id}" class="${className}" type="button" title="${title}" aria-label="${title}"${disabledAttribute}><span class="material-symbols-rounded">${icon}</span></button>`;
}

function projectControlClusterHtml(config) {
  return `
            <div class="project-control-cluster" aria-label="Project controls">
              ${iconButton({ id: config.connectId, className: "button primary icon-buttonish", title: "Connect", icon: "link" })}
              ${iconButton({ id: config.newProjectId, title: "New project", icon: "note_add" })}
              ${iconButton({ id: config.newRevisionId, title: config.revisionTitle, icon: "post_add" })}
              ${iconButton({ id: config.downloadId, title: config.downloadTitle, icon: "download", disabled: true })}
              <select id="${config.projectSelectId}" class="compact-select project-select" title="Project" aria-label="Project">
                <option value="">project</option>
              </select>
              <select id="${config.revisionSelectId}" class="compact-select sketch-history" title="Revision" aria-label="Revision">
                <option value="">revision</option>
              </select>
            </div>`;
}

export function renderProjectControlClusters(root = document) {
  root.querySelectorAll("[data-project-control-cluster]").forEach((host) => {
    const config = projectControlConfigs[host.dataset.projectControlCluster];
    if (!config) return;
    host.outerHTML = projectControlClusterHtml(config);
  });
}
