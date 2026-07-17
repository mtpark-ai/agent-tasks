(() => {
  const OFFICIAL_SHORTCUT_URL = "https://www.icloud.com/shortcuts/4788308f799c4e8abee863ab3ddb3334";

  function ensureShortcutQrStyles() {
    if (document.querySelector('link[href="/shortcut-qr.css"]')) return;
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/shortcut-qr.css";
    document.head.append(stylesheet);
  }

  function enhanceShortcutInstaller() {
    const shortcutLink = document.querySelector("#shortcut-link");
    const shortcutDescription = document.querySelector("#shortcut-description");
    const shortcutCard = shortcutLink?.closest(".phone-step");
    if (!shortcutLink || !shortcutDescription || !shortcutCard || document.querySelector("#shortcut-qr")) return;

    shortcutCard.classList.add("shortcut-install-step");

    const layout = document.createElement("div");
    layout.className = "shortcut-install-layout";

    const actions = document.createElement("div");
    actions.className = "shortcut-install-action";
    actions.append(shortcutDescription, shortcutLink);

    const mobileHint = document.createElement("p");
    mobileHint.className = "hint";
    mobileHint.textContent = "正在 iPhone 上打开本页？直接点击上面的安装按钮。";
    actions.append(mobileHint);

    const figure = document.createElement("figure");
    figure.className = "shortcut-qr-figure";
    figure.id = "shortcut-qr";

    const qrLink = document.createElement("a");
    qrLink.href = OFFICIAL_SHORTCUT_URL;
    qrLink.target = "_blank";
    qrLink.rel = "noopener noreferrer";
    qrLink.setAttribute("aria-label", "打开官方 Agent Tasks 快捷指令安装页面");

    const image = document.createElement("img");
    image.src = "/shortcut-qr.svg";
    image.alt = "扫描二维码安装 Agent Tasks 快捷指令";
    image.width = 220;
    image.height = 220;
    image.loading = "lazy";
    image.decoding = "async";
    qrLink.append(image);

    const caption = document.createElement("figcaption");
    caption.textContent = "用 iPhone 相机扫描，安装官方通用版";

    figure.append(qrLink, caption);
    layout.append(actions, figure);
    shortcutCard.append(layout);
  }

  ensureShortcutQrStyles();
  enhanceShortcutInstaller();

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

  function buildSettingsUrl(repository) {
    return `https://github.com/${repository.owner}/${repository.repo}/settings`;
  }

  function createPrivacyCard() {
    const card = document.createElement("section");
    card.className = "repository-privacy-card";
    card.setAttribute("aria-labelledby", "repository-privacy-title");
    card.innerHTML = `
      <div class="repository-privacy-icon" aria-hidden="true">🔒</div>
      <div class="repository-privacy-copy">
        <p class="eyebrow">先保护任务内容</p>
        <h4 id="repository-privacy-title">推荐把任务仓库设为 Private</h4>
        <p>Cloudflare 创建仓库时，请开启 <strong>Create private Git repository</strong>。如果已经部署成公开仓库，可以在 GitHub 设置中改为 Private。</p>
        <ul class="privacy-checklist">
          <li>模板仓库可以保持公开；你自己的任务仓库建议私有。</li>
          <li>本地设置命令会检查可见性，公开仓库默认暂停安装。</li>
          <li>不需要给 Worker 增加 Administration 权限。</li>
        </ul>
        <div class="repository-privacy-actions">
          <a
            class="secondary link-button disabled-link"
            id="repository-settings-link"
            href="#computer-setup"
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled="true"
          >先填写仓库地址</a>
          <span id="repository-privacy-note">填写仓库后，可直接打开对应的 GitHub 设置页面。</span>
        </div>
      </div>
    `;

    const repoHelp = document.querySelector("#repo-help");
    if (repoHelp) repoHelp.insertAdjacentElement("afterend", card);
    else repoInput.closest(".instruction-body")?.append(card);
    return card;
  }

  const privacyCard = createPrivacyCard();
  const settingsLink = privacyCard.querySelector("#repository-settings-link");
  const privacyNote = privacyCard.querySelector("#repository-privacy-note");

  const expectedItems = document.querySelectorAll(".expect-list li");
  const privacyExpectation = expectedItems[2];
  if (privacyExpectation) {
    const title = privacyExpectation.querySelector("strong");
    const description = privacyExpectation.querySelector("small");
    if (title) title.textContent = "确认任务仓库是私有的";
    if (description) description.textContent = "若检测到 Public，终端会打开 GitHub 设置并暂停，直到改成 Private。";
  }

  const faqGrid = document.querySelector(".faq-grid");
  if (faqGrid && !document.querySelector("#private-repository-faq")) {
    const faq = document.createElement("details");
    faq.id = "private-repository-faq";
    faq.innerHTML = `
      <summary>Cloudflare 创建的仓库是 Public，怎么办？</summary>
      <p>填写上方仓库地址后，点击“打开 GitHub 仓库设置”，再进入 General → Danger Zone → Change repository visibility → Make private。设置命令会重新检查；不需要给授权码增加 Administration 权限。</p>
    `;
    faqGrid.prepend(faq);
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

      settingsLink.href = "#computer-setup";
      settingsLink.textContent = "先填写仓库地址";
      settingsLink.classList.add("disabled-link");
      settingsLink.setAttribute("aria-disabled", "true");
      privacyNote.textContent = "填写仓库后，可直接打开对应的 GitHub 设置页面。";
      return;
    }

    tokenLink.href = buildTokenUrl(repository);
    tokenLink.textContent = "创建 GitHub 授权码（权限已预填）";
    tokenLink.classList.remove("disabled-link");
    tokenLink.setAttribute("aria-disabled", "false");
    tokenLinkNote.textContent = `已为 ${repository.owner}/${repository.repo} 预填名称、365 天有效期和所需权限。`;
    ownerValue.textContent = repository.owner;
    repositoryValue.textContent = repository.repo;

    settingsLink.href = buildSettingsUrl(repository);
    settingsLink.textContent = "打开 GitHub 仓库设置";
    settingsLink.classList.remove("disabled-link");
    settingsLink.setAttribute("aria-disabled", "false");
    privacyNote.textContent = `请确认 ${repository.owner}/${repository.repo} 显示为 Private。`;
  }

  function focusRepositoryInput(event) {
    event.preventDefault();
    repoInput.focus();
    repoInput.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  tokenLink.addEventListener("click", (event) => {
    if (tokenLink.getAttribute("aria-disabled") === "true") focusRepositoryInput(event);
  });
  settingsLink.addEventListener("click", (event) => {
    if (settingsLink.getAttribute("aria-disabled") === "true") focusRepositoryInput(event);
  });

  repoInput.addEventListener("input", render);
  render();
})();
