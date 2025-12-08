export async function tryDiscoveryEvent(player, room) {
  if (!room.events) room.events = []
  return {
    id: "event-discovery-generic",
    name: "Estrutura oculta",
    text: "Algo se revela."
  }
}
