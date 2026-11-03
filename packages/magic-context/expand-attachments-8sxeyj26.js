// ../plugin/src/v2/hooks/expand-attachments.ts
function createV2RecoveryAttachments(reader) {
  return (sessionId, messageId) => {
    const row = reader.messageById(sessionId, messageId);
    if (row?.type !== "user" || !Array.isArray(row.data.files))
      return [];
    return row.data.files.map((file, index) => {
      const source = file.source;
      return {
        type: "file",
        filename: file.name,
        mime: file.mime,
        url: source?.uri,
        partIndex: index + 1
      };
    });
  };
}
export {
  createV2RecoveryAttachments
};
