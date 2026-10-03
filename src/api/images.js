/**
 * Resolve a Foundry Item image.
 *
 * Remote HTTP(S) images can remain URLs.
 * Foundry-local assets are fetched from Foundry itself and returned as a File
 * so they can be uploaded directly to Harkonians without base64 expansion.
 */
export async function fetchFoundryImage(imagePath) {
    if (!imagePath || typeof imagePath !== "string") {
        return null;
    }

    const trimmed = imagePath.trim();

    if (!trimmed) {
        return null;
    }

    if (
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://")
    ) {
        return {
            type: "url",
            url: trimmed
        };
    }

    const response = await fetch(trimmed);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();

    const fileName =
        trimmed
            .split("/")
            .pop()
            ?.split("?")[0]
            ?.split("#")[0]
        || "foundry-image";

    const contentType =
        blob.type ||
        inferContentType(fileName);

    const file = new File(
        [blob],
        fileName,
        { type: contentType }
    );

    return {
        type: "file",
        file,
        fileName,
        contentType,
        size: file.size
    };
}

function inferContentType(fileName) {
    const extension =
        fileName
            .split(".")
            .pop()
            ?.toLowerCase();

    switch (extension) {
        case "webp":
            return "image/webp";
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "gif":
            return "image/gif";
        case "avif":
            return "image/avif";
        case "svg":
            return "image/svg+xml";
        default:
            return "application/octet-stream";
    }
}
