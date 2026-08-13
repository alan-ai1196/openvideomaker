# UX Principles

Explicit UX invariants for OpenVideoMaker. These are product law, not
aspiration.

1. **A creator should not need to understand models.** Users choose
   intent and quality/speed; capability resolution happens underneath.
2. **Every AI result remains editable.** Generated output lands in the
   same project/timeline model as anything else — never a dead-end file.
3. **Manual editing never becomes second-class.** AI actions sit next to
   normal edit actions; the timeline is always the source of truth.
4. **AI actions explain what changed** — in creator language (clips
   shortened, pauses removed, duration changed), never chain-of-thought.
5. **Advanced controls use progressive disclosure.** Model details,
   devices, integrations live behind Advanced/Developer areas.
6. **Failure messages tell the user what to do next.** "This model needs
   more GPU memory than is available" + concrete options — not raw
   stack traces or "CUDA out of memory".
7. **Hardware differences do not create incompatible project formats.**
   A laptop project opens unchanged on a workstation.
8. **Projects should survive model changes.** Provenance keeps old
   generations understandable when their model is gone.
9. **AI should appear inside editing workflows**, not only inside chat.
   Select a clip → see Remove Silence / Clean Audio / Dub Voice /
   Lip Sync. Chat is complementary.
10. **The default experience optimizes creation, not configuration.**
    First screen: what do you want to make? Not a settings dialog.