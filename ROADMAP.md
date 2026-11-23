# Product Roadmap

This is the consolidated backlog from the former `FUTURE_PLAN.md` and `SPARK_IDEAS.md`. Completed work is described in the [README](README.md); operational and deployment gaps are tracked separately in [ISSUES.md](ISSUES.md).

Items are ideas, not commitments or dated releases. Revisit priorities as user needs become clearer.

## Near-term product improvements

### Diagram editing and accessibility

- [ ] Copy SVG markup directly to the clipboard.
- [ ] Generate an optional diagram title/caption and include it in SVG exports and history.
- [ ] Compare diagram versions from local history.
- [ ] Add `role="img"` and a useful accessible label to the rendered diagram.
- [ ] Support keyboard focus and arrow-key panning.
- [ ] Honor `prefers-reduced-motion` for pan and zoom transitions.
- [ ] Offer one-click recovery suggestions such as simplifying a diagram or changing its direction.
- [ ] Report Mermaid render failures in a way that can inform product quality improvements.

### Usage insights

- [ ] Track diagram type and direction usage.
- [ ] Build a lightweight usage dashboard for generation volume, popular diagram types, and error rates.
- [ ] Measure provider latency and token usage to inform cost controls.

### Export and templates

- [ ] Add PDF export.
- [ ] Explore LaTeX export and batch export.
- [ ] Create a searchable library of editable diagram templates with previews.

## Larger product directions

### Accounts and collaboration

- [ ] Add optional accounts while preserving a guest workflow.
- [ ] Add user profiles, secure sessions, email verification, and account recovery.
- [ ] Consider OAuth providers such as Google and GitHub.
- [ ] Add team workspaces, diagram permissions, comments, and presence indicators.
- [ ] Explore version history with branching, merging, and audit events.

### Document intelligence

- [ ] Add document summaries and key-point extraction.
- [ ] Explore chat across one or more documents with citations to source passages.
- [ ] Consider background jobs for large or batch document processing.

### Integrations and API access

- [ ] Add API key management for programmatic users.
- [ ] Consider webhooks and automation integrations.
- [ ] Explore Slack/Teams, GitHub/GitLab, Notion/Confluence, or Zapier/Make integrations.

### Platform expansion

- [ ] Add interface localization and language selection.
- [ ] Explore image input and multimodal diagram generation.
- [ ] Improve style controls and learn from user-approved edits.
- [ ] Revisit enterprise SSO and compliance features if the product gains organizational users.

## Revisit when

- Accounts and teams become necessary for users to collaborate or persist diagrams across devices.
- Document Q&A is a clear product direction and its indexing, privacy, and operating costs are understood.
- Integrations are requested by users who already rely on the API or shared links.
- Enterprise or compliance work is justified by real organizational requirements.
