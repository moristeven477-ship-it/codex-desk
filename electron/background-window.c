#define _GNU_SOURCE
#include <dlfcn.h>
#include <string.h>

/* Loaded only into Desk's dedicated GNOME Terminal server. Its factory calls
 * gtk_window_present even for present-window=false when creating a window.
 * Start our first window iconified, before mapping, so no focus/raise occurs.
 * Subsequent user-initiated presentation follows GTK normally. */
static int show_in_background(void *window) {
    const char *(*get_role)(void *) = dlsym(RTLD_NEXT, "gtk_window_get_role");
    void *(*get_data)(void *, const char *) = dlsym(RTLD_NEXT, "g_object_get_data");
    void (*set_data)(void *, const char *, void *) = dlsym(RTLD_NEXT, "g_object_set_data");
    void (*focus_on_map)(void *, int) = dlsym(RTLD_NEXT, "gtk_window_set_focus_on_map");
    void (*iconify)(void *) = dlsym(RTLD_NEXT, "gtk_window_iconify");
    void (*show)(void *) = dlsym(RTLD_NEXT, "gtk_widget_show");
    if (!get_role || !get_data || !set_data || !focus_on_map || !iconify || !show) return 0;
    const char *role = get_role(window);
    if (!role || strcmp(role, "codex-desk-conversations") || get_data(window, "codex-desk-mapped")) return 0;
    set_data(window, "codex-desk-mapped", (void *)1);
    focus_on_map(window, 0);
    iconify(window);
    show(window);
    return 1;
}

void gtk_window_present(void *window) {
    if (show_in_background(window)) return;
    void (*original)(void *) = dlsym(RTLD_NEXT, "gtk_window_present");
    if (original) original(window);
}

void gtk_window_present_with_time(void *window, unsigned int timestamp) {
    if (show_in_background(window)) return;
    void (*original)(void *, unsigned int) = dlsym(RTLD_NEXT, "gtk_window_present_with_time");
    if (original) original(window, timestamp);
}
