local wezterm = require("wezterm")

local config = wezterm.config_builder()

config.automatically_reload_config = true
config.enable_tab_bar = true
config.scrollback_lines = 10000
config.use_dead_keys = false
config.window_close_confirmation = "NeverPrompt"
config.window_decorations = "RESIZE"
config.default_cursor_style = "BlinkingBlock"
config.cursor_blink_rate = 0
config.font = wezterm.font("FiraCode Nerd Font", { weight = 450, stretch = "Normal", style = "Normal" })
config.font_size = 14
config.window_background_opacity = 1
config.background = {
	{
		source = {
			Color = "#1C1F26",
		},
		width = "100%",
		height = "100%",
		opacity = 0.95,
	},
}
config.window_padding = {
	left = 0,
	right = 0,
	top = 0,
	bottom = 0,
}

local function load_neovim_colorscheme()
	-- Colorscheme
	local file = io.open(wezterm.config_dir .. "/colorscheme", "r")
	if file then
		config.color_scheme = file:read("*a")
		file:close()
	else
		config.color_scheme = "Catppuccin Mocha"
	end
end

load_neovim_colorscheme()

return config
