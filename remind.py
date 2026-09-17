"""
Slack channel reminder.
Checks who hasn't posted in the channel today (SGT) and tags them.
Uses a bot token, so the bot must be invited into the channel first:
    /invite @YourBotName
"""
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

# ---------- EDIT THESE ----------
CHANNEL_ID = "C0C0S37SA2U"               # #spm-team2 channel ID
TEAM = ["U0BQ65DLTFH", "U0BQBNLBTLK", "U0BQHS7J0VB", "U0BRCACG30Q", "U0BQG127CMC", "U0BQHUR8W1Y"]    # member IDs to chase
MESSAGE = "Hi {tags}, please submit your daily standup soon, thank you!"
# --------------------------------

TOKEN = os.environ.get("SLACK_BOT_TOKEN")
DRY_RUN = os.environ.get("DRY_RUN") == "1"   # set DRY_RUN=1 to test without posting

if not TOKEN:
    sys.exit("SLACK_BOT_TOKEN is not set")

client = WebClient(token=TOKEN)


def start_of_today_sgt():
    now = datetime.now(ZoneInfo("Asia/Singapore"))
    return now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def who_posted(since):
    """Everyone who sent a message (or thread reply) since `since`."""
    posted = set()
    cursor = None
    while True:
        resp = client.conversations_history(
            channel=CHANNEL_ID, oldest=str(since), limit=200, cursor=cursor
        )
        for m in resp["messages"]:
            if m.get("user"):
                posted.add(m["user"])
            if m.get("reply_count"):
                replies = client.conversations_replies(
                    channel=CHANNEL_ID, ts=m["ts"], oldest=str(since), limit=200
                )
                for r in replies["messages"]:
                    if r.get("user"):
                        posted.add(r["user"])
        cursor = resp.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break
    return posted


def main():
    try:
        posted = who_posted(start_of_today_sgt())
        missing = [u for u in TEAM if u not in posted]

        if not missing:
            print("Everyone has posted today, nothing to send.")
            return

        tags = " ".join(f"<@{u}>" for u in missing)
        text = MESSAGE.format(tags=tags)

        if DRY_RUN:
            print(f"[DRY RUN] Would post: {text}")
            return

        client.chat_postMessage(channel=CHANNEL_ID, text=text)
        print(f"Reminder sent to: {', '.join(missing)}")

    except SlackApiError as e:
        sys.exit(f"Slack error: {e.response['error']}")


if __name__ == "__main__":
    main()
