local wezterm = require("wezterm")

local config = wezterm.config_builder()

config.automatically_reload_config = true
config.enable_tab_bar = false
config.scrollback_lines = 10000
config.use_dead_keys = false
config.window_close_confirmation = "NeverPrompt"
config.window_decorations = "RESIZE"
config.default_cursor_style = "BlinkingBlock"
config.cursor_blink_rate = 0
config.font = wezterm.font("FiraCode Nerd Font", { weight = 450, stretch = "Normal", style = "Normal" })
config.font_size = 14
config.window_background_opacity = .9
-- background = {
--     {
--         source = {
--             Color = "#1a1b26",
--         },
--         width = "100%",
--         height = "100%",
--         opacity = 0.90,
--
--     }
-- },
config.window_padding = {
    left = 3,
    right = 3,
    top = 20,
    bottom = 0,
}




-- Colorscheme
local file = io.open(wezterm.config_dir .. "/colorscheme", "r")
if file then
    config.color_scheme = file:read("*a")
    file:close()
else
    config.color_scheme = 'Catppuccin Mocha'
end

return config
