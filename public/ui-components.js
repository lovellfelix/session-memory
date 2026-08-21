/**
 * ui-components.js
 * Reusable shadcn/ui-style render helpers for the Session Memory MCP Dashboard.
 *
 * Each function returns an HTML string (or creates a DOM element) and is
 * intentionally pure/stateless so it can be used from any data-loading
 * function without coupling to specific section logic.
 */

// ---------------------------------------------------------------------------
// HTML escape (XSS prevention) – also used by other modules
// ---------------------------------------------------------------------------
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return ""
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// ---------------------------------------------------------------------------
// Empty / Error state helpers – shadcn/ui-style "ghost" card body rows
// ---------------------------------------------------------------------------

/**
 * Returns an HTML <tr> block for use inside a <tbody> when there is no data.
 * @param {string} icon  - Lucide icon name
 * @param {string} title
 * @param {string} description
 * @param {number} [colspan=6]
 */
function emptyStateHtml(icon, title, description, colspan = 6) {
  return `
        <tr>
            <td colspan="${colspan}" class="px-6 py-12 text-center">
                <div class="flex flex-col items-center justify-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <i data-lucide="${icon}" class="w-6 h-6 text-gray-400 dark:text-gray-500" aria-hidden="true"></i>
                    </div>
                    <div class="text-sm font-medium text-gray-600 dark:text-gray-400">${escapeHtml(title)}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-500 max-w-xs">${escapeHtml(description)}</div>
                </div>
            </td>
        </tr>`
}

/**
 * Returns an HTML <tr> block for use inside a <tbody> when a load error occurred.
 * @param {string} message
 * @param {number} [colspan=6]
 * @param {string|null} [retryFnName] - Global function name to call on retry
 */
function errorStateHtml(message, colspan = 6, retryFnName = null) {
  const retryBtn = retryFnName
    ? `<button onclick="${retryFnName}()"
               class="mt-3 px-4 py-2 text-xs font-medium bg-red-50 dark:bg-red-900/20 text-red-600
                      dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
               <i data-lucide="refresh-cw" class="w-3 h-3 inline mr-1" aria-hidden="true"></i>
               Retry
           </button>`
    : ""

  return `
        <tr>
            <td colspan="${colspan}" class="px-6 py-12 text-center">
                <div class="flex flex-col items-center justify-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                        <i data-lucide="alert-circle" class="w-6 h-6 text-red-500 dark:text-red-400" aria-hidden="true"></i>
                    </div>
                    <div class="text-sm font-medium text-red-600 dark:text-red-400">${escapeHtml(message)}</div>
                    ${retryBtn}
                </div>
            </td>
        </tr>`
}

/**
 * Returns an HTML block for empty card-grid views.
 */
function emptyStateCardHtml(icon, title, description) {
  return `
        <div class="col-span-full flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div class="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center ring-1 ring-gray-200 dark:ring-gray-700">
                <i data-lucide="${icon}" class="w-7 h-7 text-gray-400 dark:text-gray-500" aria-hidden="true"></i>
            </div>
            <div class="text-sm font-semibold text-gray-700 dark:text-gray-300">${escapeHtml(title)}</div>
            <div class="text-xs text-gray-500 dark:text-gray-500 max-w-xs leading-relaxed">${escapeHtml(description)}</div>
        </div>`
}

// ---------------------------------------------------------------------------
// Skeleton loading rows
// ---------------------------------------------------------------------------

/**
 * Returns N skeleton <tr> rows with the given column widths.
 * @param {number} rows
 * @param {string[]} colWidths - CSS width values per column (e.g. ['120px', '80px'])
 */
function skeletonRows(rows, colWidths) {
  const cells = colWidths
    .map(
      w =>
        `<td class="px-6 py-4"><div class="skeleton skeleton-text" style="width:${w}"></div></td>`
    )
    .join("")
  return Array(rows).fill(`<tr>${cells}</tr>`).join("")
}

// ---------------------------------------------------------------------------
// Badge helpers – shadcn/ui-style pill badges
// ---------------------------------------------------------------------------

/** Generic badge */
function badge(text, extraClasses = "") {
  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${extraClasses}">${escapeHtml(text)}</span>`
}

/**
 * Single source of truth for the five task states (id, label, badge colors).
 * Previously duplicated across taskStateBadge's cfg, the edit-task modal's
 * <option> list, and index.html's #task-state-filter <option> list.
 */
const TASK_STATES = [
  {
    id: "queued",
    label: "Queued",
    bg: "bg-gray-100 dark:bg-gray-700",
    fg: "text-gray-800 dark:text-gray-300",
  },
  {
    id: "in_progress",
    label: "In Progress",
    bg: "bg-blue-100 dark:bg-blue-900",
    fg: "text-blue-800 dark:text-blue-200",
  },
  {
    id: "done",
    label: "Done",
    bg: "bg-green-100 dark:bg-green-900",
    fg: "text-green-800 dark:text-green-200",
  },
  {
    id: "failed",
    label: "Failed",
    bg: "bg-red-100 dark:bg-red-900",
    fg: "text-red-800 dark:text-red-200",
  },
  {
    id: "blocked",
    label: "Blocked",
    bg: "bg-orange-100 dark:bg-orange-900",
    fg: "text-orange-800 dark:text-orange-200",
  },
]

/** Task state badge with semantic colors */
function taskStateBadge(state) {
  const c = TASK_STATES.find(s => s.id === state) ?? {
    bg: "bg-gray-100 dark:bg-gray-700",
    fg: "text-gray-800 dark:text-gray-300",
    label: state ?? "Unknown",
  }
  return badge(c.label, `${c.bg} ${c.fg}`)
}

/** Priority badge with color scale */
function priorityBadge(priority) {
  if (!priority && priority !== 0) return '<span class="text-gray-400 text-sm">N/A</span>'
  let colorClass = "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200"
  if (priority >= 75) colorClass = "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
  else if (priority >= 50)
    colorClass = "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200"
  else if (priority >= 25)
    colorClass = "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200"
  return badge(String(priority), colorClass)
}

/** Confidence bar */
function confidenceBadge(confidence) {
  if (confidence === null || confidence === undefined)
    return '<span class="text-xs text-gray-400">N/A</span>'
  const pct = (confidence * 100).toFixed(0)
  let cls = "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
  if (confidence < 0.6) cls = "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
  else if (confidence < 0.8)
    cls = "bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400"
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}">${pct}%</span>`
}

// ---------------------------------------------------------------------------
// Truncation helper
// ---------------------------------------------------------------------------

/**
 * Truncate text with a title tooltip.
 * @param {string|*} text
 * @param {number} [maxLength=100]
 */
function truncate(text, maxLength = 100) {
  if (!text) return "N/A"
  if (typeof text !== "string") text = JSON.stringify(text)
  if (text.length <= maxLength) return escapeHtml(text)
  return `<span title="${escapeHtml(text)}">${escapeHtml(text.substring(0, maxLength))}…</span>`
}

// ---------------------------------------------------------------------------
// Date/time formatters
// ---------------------------------------------------------------------------

function formatDate(dateString) {
  if (!dateString) return "N/A"
  try {
    const date = new Date(dateString)
    const diff = Date.now() - date.getTime()
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    if (seconds < 60) return "just now"
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`
    if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`
    if (days === 1) return "Yesterday"
    if (days < 7) return `${days} days ago`
    return date.toLocaleDateString()
  } catch {
    return "Invalid date"
  }
}

function formatTimestamp(dateString) {
  if (!dateString) return "N/A"
  try {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return "Invalid date"
  }
}

// ---------------------------------------------------------------------------
// Card renderers – used by the "card view" toggle in each section
// ---------------------------------------------------------------------------

/**
 * Generic card click handler helper. Parses data from data-json attribute
 * and calls openModal().
 */
function _attachCardClickHandlers(container) {
  container.querySelectorAll("[data-card-type]").forEach(card => {
    card.addEventListener("click", () => {
      const type = card.getAttribute("data-card-type")
      const data = JSON.parse(card.getAttribute("data-json") || "{}")
      openModal(type, data)
    })
  })
}

function _cardHtml(type, headingText, badgeHtml, bodyLines, jsonData) {
  const encoded = escapeHtml(JSON.stringify(jsonData))
  return `
        <div class="card-item cursor-pointer rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-200" data-card-type="${type}" data-json="${encoded}" role="article" tabindex="0" aria-label="${escapeHtml(headingText)}">
            <div class="flex items-start justify-between gap-2 mb-3">
                <h4 class="font-medium text-sm text-gray-900 dark:text-gray-100 truncate flex-1">${escapeHtml(headingText)}</h4>
                ${badgeHtml}
            </div>
            <div class="text-sm space-y-1.5 text-gray-600 dark:text-gray-400">
                ${bodyLines.map(l => `<p class="leading-relaxed">${l}</p>`).join("")}
            </div>
        </div>`
}

function renderContextCards(data, container) {
  if (!data.length) {
    container.innerHTML = emptyStateCardHtml(
      "database",
      "No session contexts found",
      "Session contexts will appear here once you start using the MCP server."
    )
    lucide.createIcons()
    return
  }
  container.innerHTML = data
    .map(ctx =>
      _cardHtml(
        "context",
        ctx.session_id ?? "N/A",
        `<span class="badge">${escapeHtml(ctx.context_type ?? "N/A")}</span>`,
        [
          `<strong>Key:</strong> <code>${escapeHtml(ctx.key ?? "N/A")}</code>`,
          `<strong>Value:</strong> ${truncate(ctx.value, 120)}`,
          `<span class="text-xs text-gray-400">Updated ${formatDate(ctx.updated_at)}</span>`,
        ],
        ctx
      )
    )
    .join("")
  _attachCardClickHandlers(container)
  lucide.createIcons()
}

function renderPreferenceCards(data, container) {
  if (!data.length) {
    container.innerHTML = emptyStateCardHtml(
      "sliders",
      "No user preferences found",
      "User preferences are learned automatically as you interact with the system."
    )
    lucide.createIcons()
    return
  }
  container.innerHTML = data
    .map(pref =>
      _cardHtml(
        "preference",
        pref.user_id ?? "N/A",
        `<span class="badge">${escapeHtml(pref.category ?? "N/A")}</span>`,
        [
          `<strong>${escapeHtml(pref.preference_key ?? "N/A")}:</strong> ${truncate(pref.preference_value, 80)}`,
          `<strong>Confidence:</strong> ${confidenceBadge(pref.confidence)}`,
          `<span class="text-xs text-gray-400">Updated ${formatDate(pref.updated_at)}</span>`,
        ],
        pref
      )
    )
    .join("")
  _attachCardClickHandlers(container)
  lucide.createIcons()
}

function renderConventionCards(data, container) {
  if (!data.length) {
    container.innerHTML = emptyStateCardHtml(
      "book-open",
      "No project conventions found",
      "Project conventions are learned as you work with different codebases."
    )
    lucide.createIcons()
    return
  }
  container.innerHTML = data
    .map(conv =>
      _cardHtml(
        "convention",
        conv.project_id ?? "N/A",
        `<span class="badge">${escapeHtml(conv.language ?? "N/A")}</span>`,
        [
          `<strong>Type:</strong> ${escapeHtml(conv.convention_type ?? "N/A")}`,
          `<strong>Key:</strong> ${truncate(conv.convention_key, 100)}`,
          `<span class="text-xs text-gray-400">Updated ${formatDate(conv.updated_at)}</span>`,
        ],
        conv
      )
    )
    .join("")
  _attachCardClickHandlers(container)
  lucide.createIcons()
}

function renderInteractionCards(data, container) {
  if (!data.length) {
    container.innerHTML = emptyStateCardHtml(
      "message-square",
      "No interactions found",
      "Interaction history will appear here as you use the system."
    )
    lucide.createIcons()
    return
  }
  container.innerHTML = data
    .map(int =>
      _cardHtml(
        "interaction",
        int.session_id ?? "N/A",
        `<span class="badge role-${int.role ?? "unknown"}">${escapeHtml(int.role ?? "N/A")}</span>`,
        [
          truncate(int.content, 150),
          `<span class="text-xs text-gray-400">Created ${formatDate(int.created_at)}</span>`,
        ],
        int
      )
    )
    .join("")
  _attachCardClickHandlers(container)
  lucide.createIcons()
}

// ---------------------------------------------------------------------------
// Modal content builders (detail views)
// ---------------------------------------------------------------------------

/**
 * Builds a <dl>-style key-value detail list.
 * @param {Array<{label:string, value:string}>} rows
 */
function detailList(rows) {
  return `<dl class="space-y-3">
        ${rows
          .map(
            r => `
            <div class="flex flex-col sm:flex-row sm:gap-4">
                <dt class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider sm:w-28 flex-shrink-0">${escapeHtml(r.label)}</dt>
                <dd class="mt-0.5 sm:mt-0 text-sm text-gray-900 dark:text-gray-100">${r.value}</dd>
            </div>`
          )
          .join("")}
    </dl>`
}

/**
 * Returns the innerHTML for the modal body given record type + data.
 * Used by populateModal() in dashboard.js.
 */
function buildModalContent(type, data) {
  switch (type) {
    case "context":
      return detailList([
        { label: "Session ID", value: escapeHtml(data.session_id ?? "N/A") },
        {
          label: "Context Type",
          value: `<span class="badge">${escapeHtml(data.context_type ?? "N/A")}</span>`,
        },
        {
          label: "Key",
          value: `<code class="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">${escapeHtml(data.key ?? "N/A")}</code>`,
        },
        {
          label: "Value",
          value: `<pre class="whitespace-pre-wrap text-xs bg-gray-50 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto">${escapeHtml(data.value ?? "N/A")}</pre>`,
        },
        { label: "Updated", value: escapeHtml(formatDate(data.updated_at)) },
      ])

    case "preference":
      return detailList([
        { label: "User ID", value: escapeHtml(data.user_id ?? "N/A") },
        { label: "Preference", value: escapeHtml(data.preference_key ?? "N/A") },
        { label: "Value", value: escapeHtml(data.preference_value ?? "N/A") },
        { label: "Confidence", value: confidenceBadge(data.confidence) },
        { label: "Updated", value: escapeHtml(formatDate(data.updated_at)) },
      ])

    case "convention":
      return detailList([
        {
          label: "Project ID",
          value: `<span class="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">${escapeHtml(data.project_id ?? "N/A")}</span>`,
        },
        {
          label: "Language",
          value: `<span class="badge language-${data.language ?? "unknown"}">${escapeHtml(data.language ?? "N/A")}</span>`,
        },
        { label: "Type", value: escapeHtml(data.convention_type ?? "N/A") },
        {
          label: "Pattern",
          value: `<pre class="whitespace-pre-wrap text-xs bg-gray-50 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto">${escapeHtml(data.pattern ?? "N/A")}</pre>`,
        },
        ...(data.example
          ? [
              {
                label: "Example",
                value: `<pre class="whitespace-pre-wrap text-xs bg-gray-50 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto">${escapeHtml(data.example)}</pre>`,
              },
            ]
          : []),
        { label: "Updated", value: escapeHtml(formatDate(data.updated_at)) },
      ])

    case "interaction":
      return detailList([
        {
          label: "Session ID",
          value: `<span class="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">${escapeHtml(data.session_id ?? "N/A")}</span>`,
        },
        {
          label: "Role",
          value: `<span class="badge role-${data.role ?? "unknown"}">${escapeHtml(data.role ?? "N/A")}</span>`,
        },
        {
          label: "Content",
          value: `<div class="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg text-xs max-h-60 overflow-y-auto"><pre class="whitespace-pre-wrap">${escapeHtml(data.content ?? "N/A")}</pre></div>`,
        },
        ...(data.metadata
          ? [
              {
                label: "Metadata",
                value: `<div class="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg text-xs max-h-40 overflow-y-auto"><pre>${escapeHtml(JSON.stringify(data.metadata, null, 2))}</pre></div>`,
              },
            ]
          : []),
        { label: "Created", value: escapeHtml(formatDate(data.created_at)) },
      ])

    case "task":
      return buildTaskModalContent(data)

    default:
      return `<p class="text-sm text-gray-500">No detail view available for type "${escapeHtml(type)}".</p>`
  }
}

/** Full task detail view (richer layout). */
function buildTaskModalContent(data) {
  return `
        <div class="space-y-4">
            <div class="flex items-center gap-3 pb-4 border-b border-gray-200 dark:border-gray-700 flex-wrap">
                <span class="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 font-mono">#${escapeHtml(String(data.id ?? "N/A"))}</span>
                ${taskStateBadge(data.state)}
                ${priorityBadge(data.priority)}
            </div>

            <div class="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <h3 class="text-base font-bold text-gray-900 dark:text-gray-100 mb-1">${escapeHtml(data.title ?? "Untitled")}</h3>
                ${
                  data.description
                    ? `<p class="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">${escapeHtml(data.description)}</p>`
                    : '<p class="text-sm text-gray-400 italic">No description provided</p>'
                }
            </div>

            <div class="grid grid-cols-2 gap-3">
                ${_infoCell("Agent", data.agent_id ?? "N/A", "")}
                ${_infoCell("Workflow", data.workflow_id ?? "N/A", "font-mono text-xs")}
            </div>

            ${
              data.parent_task_id
                ? `
                <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-center justify-between">
                    <span class="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase">Parent Task</span>
                    <span class="text-sm font-mono text-blue-900 dark:text-blue-300">#${escapeHtml(String(data.parent_task_id))}</span>
                </div>`
                : ""
            }

            ${
              data.error_text
                ? `
                <div class="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-4 rounded">
                    <h4 class="text-sm font-semibold text-red-800 dark:text-red-400 mb-1">Error Details</h4>
                    <pre class="text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap font-mono bg-red-100 dark:bg-red-900/40 p-2 rounded">${escapeHtml(data.error_text)}</pre>
                </div>`
                : ""
            }

            <div class="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2 text-sm">
                ${_timestampRow("Created", data.created_at)}
                ${data.started_at ? _timestampRow("Started", data.started_at) : ""}
                ${data.finished_at ? _timestampRow("Finished", data.finished_at) : ""}
            </div>
        </div>`
}

function _infoCell(label, value, valueClass) {
  return `
        <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase block mb-1">${escapeHtml(label)}</span>
            <span class="text-sm font-medium text-gray-900 dark:text-gray-100 ${valueClass}">${escapeHtml(value)}</span>
        </div>`
}

function _timestampRow(label, dateString) {
  return `
        <div class="flex items-center gap-2">
            <span class="text-gray-500 dark:text-gray-400 font-medium w-16">${escapeHtml(label)}:</span>
            <span class="text-gray-900 dark:text-gray-100">${escapeHtml(formatTimestamp(dateString))}</span>
            <span class="text-gray-400 text-xs">(${escapeHtml(formatDate(dateString))})</span>
        </div>`
}

// ---------------------------------------------------------------------------
// Toast notification component
// ---------------------------------------------------------------------------

function getToastIcon(type) {
  const icons = {
    success: '<i data-lucide="check-circle" class="w-5 h-5" aria-hidden="true"></i>',
    error: '<i data-lucide="x-circle"     class="w-5 h-5" aria-hidden="true"></i>',
    warning: '<i data-lucide="alert-triangle" class="w-5 h-5" aria-hidden="true"></i>',
    info: '<i data-lucide="info"          class="w-5 h-5" aria-hidden="true"></i>',
  }
  return icons[type] ?? icons.info
}

/**
 * Display a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} [type='info']
 * @param {number} [duration=3000] - 0 = persistent until dismissed
 */
function showToast(message, type = "info", duration = 3000) {
  const container = document.getElementById("toast-container")
  if (!container) {
    console.error("Toast container not found")
    return
  }

  const typeClasses = {
    success: "bg-green-500 text-gray-900",
    error: "bg-red-500 text-white",
    warning: "bg-yellow-500 text-gray-900",
    info: "bg-blue-500 text-gray-900",
  }
  const btnClasses = {
    success: "text-gray-900/70 hover:text-gray-900",
    error: "text-white/80 hover:text-white",
    warning: "text-gray-900/70 hover:text-gray-900",
    info: "text-gray-900/70 hover:text-gray-900",
  }

  const toast = document.createElement("div")
  toast.setAttribute("role", "status")
  toast.setAttribute("aria-live", "polite")
  toast.className = [
    "flex items-center gap-4 p-4 rounded-full shadow-lg",
    typeClasses[type] ?? typeClasses.info,
    "transform transition-all duration-300 ease-in-out translate-y-4 opacity-0",
  ].join(" ")
  toast.innerHTML = `
        <span class="text-xl">${getToastIcon(type)}</span>
        <span class="font-medium">${escapeHtml(message)}</span>
        <button class="ml-auto ${btnClasses[type] ?? btnClasses.info}" onclick="this.closest('[role=status]').remove()" aria-label="Dismiss">
            <span class="text-2xl leading-none" aria-hidden="true">&times;</span>
        </button>`

  container.appendChild(toast)
  lucide.createIcons()

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-4", "opacity-0")
  })

  if (duration > 0) {
    setTimeout(() => {
      toast.classList.add("opacity-0", "translate-x-full")
      setTimeout(() => toast.remove(), 300)
    }, duration)
  }

  return toast
}
