import { fileIcon } from "./fileIcons";

export function FileIcon({
  path,
  folder = false,
}: {
  path: string;
  folder?: boolean;
}) {
  return (
    <span className="file-icon" aria-hidden="true">
      <img
        className="file-icon-dark"
        src={fileIcon(path, folder, "dark")}
        alt=""
        width={16}
        height={16}
        draggable={false}
      />
      <img
        className="file-icon-light"
        src={fileIcon(path, folder, "light")}
        alt=""
        width={16}
        height={16}
        draggable={false}
      />
    </span>
  );
}
