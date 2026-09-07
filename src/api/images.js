export async function fetchFoundryImage(
    imagePath
) {
    if (
        !imagePath ||
        typeof imagePath !== "string"
    ) {
        return null;
    }

    // Remote URL.
    if (
        imagePath.startsWith("http://") ||
        imagePath.startsWith("https://")
    ) {
        return {
            type: "url",
            url: imagePath
        };
    }

    // Foundry-local path.
    try {
        const response =
            await fetch(imagePath);

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const blob =
            await response.blob();

        const buffer =
            await blob.arrayBuffer();

        const bytes =
            new Uint8Array(buffer);

        let binary = "";

        const chunkSize = 0x8000;

        for (
            let i = 0;
            i < bytes.length;
            i += chunkSize
        ) {
            binary += String.fromCharCode(
                ...bytes.subarray(
                    i,
                    i + chunkSize
                )
            );
        }

        const base64 =
            btoa(binary);

        return {
            type: "base64",
            data: base64,
            contentType:
                blob.type ||
                "application/octet-stream"
        };
    } catch (error) {
        console.error(
            "HarkoniansVTT | Failed to read Foundry image:",
            imagePath,
            error
        );

        return null;
    }
}
