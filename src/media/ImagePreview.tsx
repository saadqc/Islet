import { useEffect, useState } from "react";
import { request } from "../core/bridge";
import type { DocumentModel } from "../core/types";
import "./imagePreview.css";

export function ImagePreview({ document: doc }: { document: DocumentModel }) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState("");
  const [size, setSize] = useState("");
  const [zoom, setZoom] = useState<number | "fit">("fit");
  useEffect(() => {
    let alive = true;
    setSource(undefined);
    setError("");
    setSize("");
    setZoom("fit");
    void request<{ mime: string; base64: string }>("fs.readAsset", {
      hostId: doc.hostId,
      path: doc.path,
    })
      .then((data) => {
        if (alive) setSource(`data:${data.mime};base64,${data.base64}`);
      })
      .catch((value) => {
        if (alive) setError(value.message || String(value));
      });
    return () => {
      alive = false;
    };
  }, [doc.id, doc.revision]);
  return (
    <section className="image-preview" aria-label="Image preview">
      <div className="image-toolbar">
        <span>{size || (error ? "Image unavailable" : "Loading image…")}</span>
        <span className="muted">
          {doc.size ? `${(doc.size / 1024).toFixed(1)} KB` : ""}
        </span>
        <label>
          Zoom{" "}
          <select
            aria-label="Image zoom"
            value={zoom}
            onChange={(e) =>
              setZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))
            }
          >
            <option value="fit">Fit</option>
            <option value="0.5">50%</option>
            <option value="1">100%</option>
            <option value="2">200%</option>
          </select>
        </label>
      </div>
      <div className="image-canvas">
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          source && (
            <img
              src={source}
              alt={doc.path.split("/").pop()}
              className={zoom === "fit" ? "fit" : ""}
              style={
                zoom === "fit"
                  ? undefined
                  : { width: `calc(var(--image-width) * ${zoom})` }
              }
              onLoad={(event) => {
                const image = event.currentTarget;
                image.style.setProperty(
                  "--image-width",
                  `${image.naturalWidth}px`,
                );
                setSize(`${image.naturalWidth} × ${image.naturalHeight}`);
              }}
              onError={() => setError("This image could not be decoded.")}
            />
          )
        )}
      </div>
    </section>
  );
}
