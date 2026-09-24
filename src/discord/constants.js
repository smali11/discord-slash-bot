// Discord interaction protocol constants.

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
};

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4, // immediate reply
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5, // "thinking…", follow up later
  DEFERRED_UPDATE_MESSAGE: 6, // ack a component, edit later
  UPDATE_MESSAGE: 7, // edit the message the component is on, immediately
  MODAL: 9,
};

export const MessageFlags = {
  EPHEMERAL: 1 << 6, // 64 — only the invoking user sees it
};

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
};

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
};
