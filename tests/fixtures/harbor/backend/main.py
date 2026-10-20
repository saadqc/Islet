from pathlib import Path
from models import Workspace


def describe(workspace: Workspace) -> str:
    """Summarize the folders in this workspace."""
    count = workspace.file_count()
    return f"{workspace.name}: {count} Python files"


workspace = Workspace(
    name="Harbor",
    folders=[Path("backend"), Path("worker")],
)

# Explore your workspace
summary = describe(workspace)
print(summary)
