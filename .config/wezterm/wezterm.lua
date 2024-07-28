local wezterm = require("wezterm")

local config = wezterm.config_builder()

config = {
    automatically_reload_config = true,
    enable_tab_bar = false,
    window_close_confirmation = "NeverPrompt",
    window_decorations = "RESIZE",
    default_cursor_style = "BlinkingBlock",
    cursor_blink_rate = 0,
    color_scheme = "tokyonight",
    font = wezterm.font("FiraCode Nerd Font", { weight = 450, stretch = "Normal", style = "Normal" }),
    font_size = 12.5,
    background = {
        {
            source = {
                Color = "#1a1b26",
            },
            width = "100%",
            height = "100%",
            opacity = 0.95,

        }
    },
    window_padding = {
        left = 3,
        right = 3,
        top = 20,
        bottom = 0,
    },


}

return config
