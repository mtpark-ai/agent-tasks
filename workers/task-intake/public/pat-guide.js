(() => {
  const repoInput = document.querySelector("#repo-url");
  const tokenLink = document.querySelector("#github-token-link");
  const tokenLinkNote = document.querySelector("#github-token-link-note");
  const ownerValue = document.querySelector("#pat-owner");
  const repositoryValue = document.querySelector("#pat-repository");

  if (!repoInput || !tokenLink || !tokenLinkNote || !ownerValue || !repositoryValue) return;

  function parseRepository(value) {
    const trimmed = String(value || "").trim().replace(/\/+$/u, "");
    const httpsMatch = trimmed.match(
      /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/iu,
    );
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

    const sshMatch = trimmed.match(
      /^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/iu,
    );
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
    return null;
  }

  function buildTokenUrl(repository) {
    const url = new URL("https://github.com/settings/personal-access-tokens/new");
    url.searchParams.set("name", "Agent Tasks Worker");
    url.searchParams.set(
      "description",
      `Create and manage task Issues for ${repository.owner}/${repository.repo}. No code access.`,
    );
    url.searchParams.set("target_name", repository.owner);
    url.searchParams.set("expires_in", "365");
    url.searchParams.set("issues", "write");
    url.searchParams.set("metadata", "read");
    return url.toString();
  }

  function render() {
    const repository = parseRepository(repoInput.value);
    if (!repository) {
      tokenLink.href = "#computer-setup";
      tokenLink.textContent = "先填写上方仓库地址";
      tokenLink.classList.add("disabled-link");
      tokenLink.setAttribute("aria-disabled", "true");
      tokenLinkNote.textContent = "填写仓库后，按钮会自动带上正确的资源所有者和最小权限。";
      ownerValue.textContent = "等待填写";
      repositoryValue.textContent = "等待填写";
      return;
    }

    tokenLink.href = buildTokenUrl(repository);
    tokenLink.textContent = "创建 GitHub 授权码（权限已预填）";
    tokenLink.classList.remove("disabled-link");
    tokenLink.setAttribute("aria-disabled", "false");
    tokenLinkNote.textContent = `已为 ${repository.owner}/${repository.repo} 预填名称、365 天有效期和所需权限。`;
    ownerValue.textContent = repository.owner;
    repositoryValue.textContent = repository.repo;
  }

  tokenLink.addEventListener("click", (event) => {
    if (tokenLink.getAttribute("aria-disabled") !== "true") return;
    event.preventDefault();
    repoInput.focus();
    repoInput.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  repoInput.addEventListener("input", render);
  render();
})();
