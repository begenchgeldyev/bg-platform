// One editing session owns one persisted project. Screens keep their own drafts.
// A File in save({ image }) is read under the same reservation as its PATCH;
// readImage(file) only reads a draft and never writes to the server.
window.createProjectEdits = function createProjectEdits({ project, limits }) {
  let persisted = project ? structuredClone(project) : null;
  let reserved = false;
  let removed = false;
  const failure = (reason, message) => ({ ok: false, reason, message });
  const success = (value) => ({ ok: true, value: structuredClone(value) });

  async function run(operation) {
    if (reserved) return failure('busy', 'A project operation is already in progress.');
    if (removed) return failure('removed', 'This project has been deleted.');
    reserved = true;
    try {
      return await operation();
    } catch {
      return failure('network', 'Network error. Please try again.');
    } finally {
      reserved = false;
    }
  }

  function read(file) {
    if (file.size > limits.maxImageBytes) {
      return Promise.resolve(
        failure('image-size', `File exceeds ${Math.round(limits.maxImageBytes / (1024 * 1024))} MB limit. Refused before reading.`),
      );
    }
    return new Promise((resolve) => {
      const failed = () => resolve(failure('image-read', 'Failed to read image. Please try again.'));
      try {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(
            typeof reader.result === 'string' && reader.result
              ? success(reader.result)
              : failure('image-read', 'Failed to read image. Please try again.'),
          );
        reader.onerror = failed;
        reader.onabort = failed;
        reader.readAsDataURL(file);
      } catch {
        failed();
      }
    });
  }

  function validProject(value, id) {
    return (
      value &&
      Number.isSafeInteger(value.id) &&
      value.id > 0 &&
      (id === undefined || value.id === id) &&
      typeof value.name === 'string' &&
      value.name.trim().length > 0 &&
      ['description', 'content', 'image', 'icon'].every((key) => value[key] === null || typeof value[key] === 'string') &&
      typeof value.isHidden === 'boolean' &&
      Array.isArray(value.tags) &&
      value.tags.every((tag) => typeof tag === 'string')
    );
  }

  return {
    get project() {
      return structuredClone(persisted);
    },
    get busy() {
      return reserved;
    },
    readImage(file) {
      return run(() => read(file));
    },
    save(changes) {
      return run(async () => {
        const payload = { ...changes };
        if (payload.image instanceof Blob) {
          const image = await read(payload.image);
          if (!image.ok) return image;
          payload.image = image.value;
        }
        const id = persisted?.id;
        const response = await fetch(id === undefined ? '/api/projects' : `/api/projects/${id}`, {
          method: id === undefined ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) return failure('http', 'Save failed. Please try again.');
        let body;
        try {
          body = await response.json();
        } catch {
          return failure('invalid-response', 'Invalid server response. Please try again.');
        }
        if (!validProject(body?.project, id)) return failure('invalid-response', 'Invalid server response. Please try again.');
        persisted = structuredClone(body.project);
        return success(persisted);
      });
    },
    remove() {
      return run(async () => {
        if (!persisted) return failure('missing', 'Save this project before deleting it.');
        const response = await fetch(`/api/projects/${persisted.id}`, { method: 'DELETE' });
        if (response.status !== 204) return failure('http', 'Delete failed. Please try again.');
        persisted = null;
        removed = true;
        return success(null);
      });
    },
  };
};
