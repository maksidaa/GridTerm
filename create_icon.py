#!/usr/bin/env python3
from PIL import Image, ImageDraw
import os
import subprocess

def create_gridterm_icon(size):
    """Create a GridTerm icon at the specified size."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Dimensions
    padding = size // 16
    corner_radius = size // 8
    inner_size = size - (padding * 2)

    # Background - dark rounded rectangle with gradient effect
    bg_color = (30, 30, 30, 255)

    # Draw rounded rectangle background
    draw.rounded_rectangle(
        [padding, padding, size - padding, size - padding],
        radius=corner_radius,
        fill=bg_color
    )

    # Add subtle border/glow
    draw.rounded_rectangle(
        [padding, padding, size - padding, size - padding],
        radius=corner_radius,
        outline=(80, 80, 80, 255),
        width=max(1, size // 128)
    )

    # Grid settings - 2x2 grid of terminals
    grid_padding = size // 12
    cell_gap = size // 24
    grid_start = padding + grid_padding
    grid_size = inner_size - (grid_padding * 2)
    cell_size = (grid_size - cell_gap) // 2
    cell_radius = size // 20

    # Terminal colors (accent colors for each cell)
    colors = [
        (99, 102, 241, 255),   # Purple/Indigo (top-left)
        (16, 185, 129, 255),   # Green (top-right)
        (245, 158, 11, 255),   # Orange (bottom-left)
        (236, 72, 153, 255),   # Pink (bottom-right)
    ]

    # Draw 4 terminal cells
    positions = [
        (0, 0), (1, 0),  # top row
        (0, 1), (1, 1),  # bottom row
    ]

    for i, (col, row) in enumerate(positions):
        x = grid_start + col * (cell_size + cell_gap)
        y = grid_start + row * (cell_size + cell_gap)

        # Cell background
        cell_bg = (20, 20, 20, 255)
        draw.rounded_rectangle(
            [x, y, x + cell_size, y + cell_size],
            radius=cell_radius,
            fill=cell_bg
        )

        # Terminal title bar
        title_height = size // 20
        accent = colors[i]
        draw.rounded_rectangle(
            [x, y, x + cell_size, y + title_height + cell_radius],
            radius=cell_radius,
            fill=accent
        )
        # Cover bottom corners of title bar
        draw.rectangle(
            [x, y + cell_radius, x + cell_size, y + title_height + cell_radius],
            fill=accent
        )

        # Terminal prompt/cursor line
        prompt_y = y + title_height + size // 16
        prompt_x = x + size // 32
        line_height = size // 40

        # Draw 2-3 "lines" of terminal output
        for line in range(3):
            line_y = prompt_y + line * (line_height + size // 48)
            if line_y + line_height > y + cell_size - size // 32:
                break

            # Prompt symbol
            prompt_width = size // 16
            draw.rectangle(
                [prompt_x, line_y, prompt_x + prompt_width, line_y + line_height],
                fill=accent
            )

            # "Text" after prompt (varying lengths)
            text_start = prompt_x + prompt_width + size // 48
            text_width = (cell_size - (prompt_x - x) - prompt_width - size // 16) * (0.8 - line * 0.2)
            if text_width > 0:
                draw.rectangle(
                    [text_start, line_y, text_start + text_width, line_y + line_height],
                    fill=(100, 100, 100, 255)
                )

    return img

def main():
    # Create iconset directory
    iconset_path = '/Users/adamgoodwin/Desktop/GridTerm/GridTerm.iconset'
    os.makedirs(iconset_path, exist_ok=True)

    # Required sizes for macOS .icns
    sizes = [16, 32, 64, 128, 256, 512, 1024]

    for size in sizes:
        icon = create_gridterm_icon(size)

        # Save regular size
        if size <= 512:
            icon.save(f'{iconset_path}/icon_{size}x{size}.png')

        # Save @2x version (half the stated size, but double pixels)
        if size >= 32 and size <= 512:
            half = size // 2
            icon_2x = create_gridterm_icon(size)
            icon_2x.save(f'{iconset_path}/icon_{half}x{half}@2x.png')

    # 512@2x is 1024
    icon_1024 = create_gridterm_icon(1024)
    icon_1024.save(f'{iconset_path}/icon_512x512@2x.png')

    print(f'Created iconset at {iconset_path}')

    # Convert to .icns using iconutil
    icns_path = '/Users/adamgoodwin/Desktop/GridTerm/icon.icns'
    result = subprocess.run(
        ['iconutil', '-c', 'icns', iconset_path, '-o', icns_path],
        capture_output=True,
        text=True
    )

    if result.returncode == 0:
        print(f'Created icon at {icns_path}')
    else:
        print(f'Error creating icns: {result.stderr}')

    # Clean up iconset
    import shutil
    shutil.rmtree(iconset_path)

if __name__ == '__main__':
    main()
