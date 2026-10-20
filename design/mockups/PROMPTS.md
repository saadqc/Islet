# Islet mockup prompts

Generated with the built-in image generation tool. These are visual concepts, not implementation screenshots or exact font/color measurements.

Dark: [islet-dark-v1.png](islet-dark-v1.png)

Light: [islet-light-v1.png](islet-light-v1.png)

## Dark generation prompt

Use case: ui-mockup.
Create a highly faithful desktop app screenshot mockup for "Islet", a minimal code editor closely matching the Islands Dark visual style. Landscape 16:10 composition, high resolution, flat straight-on screenshot, a single desktop application fills the entire image, no perspective, no external wallpaper, no marketing headlines, no annotations or watermark. Crisp realistic typography and meticulous native macOS proportions. This is a working editor concept, NOT a dashboard or website.
Native macOS titlebar at top with red/yellow/green controls, small "Islet" title and workspace name "Harbor". Compact quiet toolbar only with project switcher and small search/settings icons. No run/play button, no debugger, terminal, Git, AI, database, or plugin panels.
Use exact Islands Dark palette: outer canvas #26282C, editor surface #191A1C, tree surface #212326, UI text #D1D3D9 muted #9FA2A8, accent #3871E1. Separate rounded editor and project tree islands with subtle 6px gaps, restrained 10px corner radius, no huge padding. Dense professional PyCharm UI at realistic 13px Inter regular, headings semibold, code JetBrains Mono regular 13px with approximately 20px visual line-height at this rendering scale. Text should feel like a precise real desktop editor, never oversized.
Left thin 38px rail contains only folder and search icons. Project tree about 225px wide, header "Project", root "Harbor", expanded backend folder with app subfolder and files main.py, models.py, routes.py; collapsed frontend and worker roots beneath. Include pyproject.toml and README.md. main.py selected with muted blue selection. Realistic small filetype icons.
Editor occupies remaining width. Tabs "main.py" selected, "models.py", "App.jsx" inactive, close marks. Selected tab muted blue #233558 with border #2E4D89. Breadcrumb "backend › app › main.py". Gutter line numbers, folding chevrons, subtle indent guides. At least 26 lines visible and useful empty editor space to the right. Syntax colors: normal #BCBEC4, keyword #CF8E6D, string #6AAB73, number #2AACB8, comment #7A7E85, function declaration #56A8F5, property #C77DBB.
Exact coherent Python content, aligned and legible, roughly:
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Workspace:
    name: str
    folders: list[Path]

    def file_count(self) -> int:
        return sum(1 for folder in self.folders
                   for file in folder.rglob("*.py"))

def describe(workspace: Workspace) -> str:
    """Summarize the folders in this workspace."""
    count = workspace.file_count()
    return f"{workspace.name}: {count} Python files"

workspace = Workspace(
    name="Harbor",
    folders=[Path("backend"), Path("worker")],
)

# Explore your workspace
summary = workspace.
At final line caret after workspace dot show compact realistic completion popup anchored immediately below/right of caret, about300px wide, with rows "file_count()    int", "folders    list[Path]", "name    str". First row selected muted blue. Beneath thin separator include subtle shortcut hint "Enter to insert". Popup background #26282C border #33353B, small method/property colored icons, no cartoon styling. Do not obscure most of code.
Bottom quiet status bar: left "Python 3.12 (.venv)", right "24:21    LF    UTF-8    4 spaces". Thin scrollbar at right. Overall visual fidelity should resemble PyCharm Islands Dark with reduced feature chrome, calm compact sophisticated professional coding tool.

## Light edit prompt

Edit target: islet-dark-v1.png

Use case: ui-mockup, precise theme variant.
The input image is the EDIT TARGET: an Islet desktop editor mockup. Generate its matching PyCharm Islands LIGHT theme version. Keep the exact same resolution, window dimensions, layout, spacing, proportions, typography sizes and weights, every word of text, Python code, line numbers, folder tree, selected file and tab, cursor, completion popup placement and contents, icons, and macOS window controls. Change only the theme colors to the following. Flat crisp realistic desktop screenshot, no photographic glare, texture, wallpaper, added headline, label, annotation, or marketing treatment.
Use Islands Light outer canvas #E9EAEE, editor background pure #FFFFFF, project tree #F7F6F8, popup background #FFFFFF border #E9EAEE. UI main text #000000 or near black, secondary #5F6269, accent #3871E1. Active main.py tab #E3EBFE with #A7C5FF border. Project tree selected file and completion selected row use pale blue #D0DFFE with dark legible text. Text editor normal #080808, keywords #0033B3, strings #067D17, numbers #1750EB, comments #8C8C8C italic, function declaration #00627A, instance properties #871094, decorators #9E880D. Line numbers #AEB3C2, caret near black, subtle indent guides light gray, current line #F5F8FE. Change all toolbar/file icon strokes appropriately for light background. Maintain Inter UI and JetBrains Mono code look. Preserve native red/yellow/green controls and subtle rounded islands. Deliver only the matching light editor screenshot.
