from dataclasses import dataclass
from pathlib import Path

@dataclass
class Workspace:
    name: str
    folders: list[Path]

    def file_count(self) -> int:
        return sum(1 for folder in self.folders
                   for file in folder.rglob("*.py"))
