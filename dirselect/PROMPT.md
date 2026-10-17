Please design a simple TUI file explorer app using TypeScript and opentui. The purpose of the app
is to allow a user to maintain distinct selections of directories.

A config file stores a list of names which designate selected directories. When the app starts,
the list of names is displayed. The user may:
- rename a name
- delete a name
- open the explorer with the designated directories selected.

Multiple root directories may be shown, specified by command line parameters.

The file explorer starts at $HOME and shows directories below the root directories in tree format.
Initially, only directories are shown, but a directory may be opened to show its files, and closed.

Directories have a checkbox next to them, which may be selected / deselected. If a directory is selected,
all directories below it cannot be selected.

When the user leaves the app, they may choose to save the selected directories in the config file,
using a name that the user is prompted for.

Use Bun.
