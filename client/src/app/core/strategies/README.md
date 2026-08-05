# core/strategies

**Intentionally empty.** A `Strategy` pattern (`IItemKindStrategy` + `VariableStrategy`/
`SecretStrategy`) was considered for the `kind === 'variable' ? … : …` branching spread across
`ItemEditorPanelComponent`, `CopyItemDialogComponent`, and `ItemMutationsFacade`, and rejected: the
branching stayed shallow — a handful of two-way ternaries, each file-local and easy to read in
place. Introducing a class hierarchy for that would be exactly the kind of "pattern added because
best practice, not because a named problem needs it" `docs/CodingStandards.md` warns against.

This folder (and its README) are kept rather than deleted so the decision — and the reasoning
behind it — stays visible to whoever next touches item-kind branching, rather than silently
disappearing. If a second item kind is ever added and the branching grows past a handful of
shallow ternaries, that's the trigger to revisit this decision and actually build the Strategy
here, not a deadline that was missed.
