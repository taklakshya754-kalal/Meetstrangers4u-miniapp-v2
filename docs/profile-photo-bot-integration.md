# Profile-photo bot integration (required before enabling Explore)

The Explore API and Mini App read the table created by
`database/migrations/20261127_explore_profiles.sql`. The Telegram bot must
write pending and approved Telegram photo file IDs to that table. Do not put
Telegram bot tokens or Telegram file URLs in the Mini App.

## 1. Add an FSM state

Inside the existing `ProfileStates` group add:

```python
WAITING_FOR_PROFILE_PHOTO = State()
```

## 2. Add the bot handlers before MESSAGE RELAY

These handlers assume the existing bot already imports aiogram's
`Message`, `CallbackQuery`, `F`, `Command`, `FSMContext`,
`InlineKeyboardMarkup`, `InlineKeyboardButton`, and `WebAppInfo`.
Add any missing imports. Keep the existing admin ID and DB pool.

```python
PROFILE_PHOTO_WEBAPP = "https://meetstrangers4u-miniapp-v2.vercel.app/?screen=explore"

@dp.message(Command("setprofilepic"))
async def set_profile_photo_command(message: Message, state: FSMContext):
    uid = str(message.from_user.id)
    row = await db_pool.fetchrow(
        "SELECT approved_file_id, pending_file_id FROM public.explore_profile_photos WHERE user_id=$1",
        uid
    )
    if row and row["approved_file_id"]:
        markup = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="Change 🔃", callback_data="profile_photo_change"),
            InlineKeyboardButton(text="Cancel ❌", callback_data="profile_photo_cancel")
        ]])
        await message.answer_photo(
            photo=row["approved_file_id"],
            caption="Your profile picture is already set.",
            reply_markup=markup
        )
        if row["pending_file_id"]:
            await message.answer("Your replacement picture is already waiting for team approval.")
        return

    if row and row["pending_file_id"]:
        await message.answer("Your profile picture is already waiting for team approval.")
        return

    await state.set_state(ProfileStates.WAITING_FOR_PROFILE_PHOTO)
    await message.answer("Please send the photo you want to use as your MeetStrangers4u profile picture.")

@dp.callback_query(F.data == "profile_photo_change")
async def profile_photo_change(callback: CallbackQuery, state: FSMContext):
    await state.set_state(ProfileStates.WAITING_FOR_PROFILE_PHOTO)
    await callback.message.answer("Please send your new profile picture. Your current approved picture will remain visible until the new one is approved.")
    await callback.answer()

@dp.callback_query(F.data == "profile_photo_cancel")
async def profile_photo_cancel(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await callback.answer("Cancelled.")
    await callback.message.answer("Your current profile picture has not been changed.")

@dp.message(ProfileStates.WAITING_FOR_PROFILE_PHOTO, F.photo)
async def receive_profile_photo(message: Message, state: FSMContext):
    uid = str(message.from_user.id)
    file_id = message.photo[-1].file_id
    user = message.from_user
    username = ("@" + user.username) if user.username else (user.full_name or "No username")
    created = await db_pool.fetchrow(
        """
        INSERT INTO public.explore_profile_photos (user_id, pending_file_id, pending_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE
          SET pending_file_id=EXCLUDED.pending_file_id,
              pending_at=NOW(), updated_at=NOW()
          WHERE public.explore_profile_photos.pending_file_id IS NULL
        RETURNING user_id
        """,
        uid, file_id
    )
    if not created:
        await state.clear()
        await message.answer("You already have a picture waiting for approval. Please wait for the team to review it.")
        return

    admin_markup = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Accept ✅", callback_data=f"profile_photo_approve:{uid}"),
        InlineKeyboardButton(text="Decline ❌", callback_data=f"profile_photo_decline:{uid}")
    ]])
    admin_caption = (
        "🖼 <b>Profile Picture Review</b>\n\n"
        f"👤 <b>User:</b> {html.escape(username)}\n"
        f"🆔 <b>User ID:</b> <code>{uid}</code>\n"
        f"📅 <b>Submitted:</b> {html.escape(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))}\n"
        f"📌 <b>Existing approved picture:</b> {'Yes' if (await db_pool.fetchval('SELECT approved_file_id IS NOT NULL FROM public.explore_profile_photos WHERE user_id=$1', uid)) else 'No'}"
    )
    try:
        await bot.send_photo(
            chat_id=ADMIN_ID, photo=file_id, caption=admin_caption,
            parse_mode="HTML", reply_markup=admin_markup
        )
    except Exception:
        await db_pool.execute(
            "UPDATE public.explore_profile_photos SET pending_file_id=NULL, pending_at=NULL WHERE user_id=$1 AND pending_file_id=$2",
            uid, file_id
        )
        await state.clear()
        logging.exception("Profile photo admin delivery failed for user %s", uid)
        await message.answer("We couldn't submit your picture for review. Please try again later.")
        return

    await state.clear()
    await message.answer(
        "Your profile picture update request has been received by the MeetStrangers4u Team. "
        "Your picture will be set once it is approved."
    )

@dp.callback_query(F.data.startswith("profile_photo_approve:"))
async def approve_profile_photo(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Not authorised.", show_alert=True)
        return
    uid = callback.data.split(":", 1)[1]
    row = await db_pool.fetchrow(
        """
        UPDATE public.explore_profile_photos
           SET approved_file_id=pending_file_id,
               pending_file_id=NULL, pending_at=NULL, updated_at=NOW()
         WHERE user_id=$1 AND pending_file_id IS NOT NULL
         RETURNING user_id
        """, uid
    )
    if not row:
        await callback.answer("This request is no longer pending.", show_alert=True)
        return
    try:
        await bot.send_message(int(uid), "✅ Your MeetStrangers4u profile picture has been approved and is now visible in Explore.")
    except Exception:
        logging.warning("Could not notify profile photo approval for user %s", uid)
    await callback.message.edit_caption((callback.message.caption or "") + "\n\n✅ APPROVED", reply_markup=None)
    await callback.answer("Profile picture approved.")

@dp.callback_query(F.data.startswith("profile_photo_decline:"))
async def decline_profile_photo(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        await callback.answer("Not authorised.", show_alert=True)
        return
    uid = callback.data.split(":", 1)[1]
    row = await db_pool.fetchrow(
        """
        UPDATE public.explore_profile_photos
           SET pending_file_id=NULL, pending_at=NULL, updated_at=NOW()
         WHERE user_id=$1 AND pending_file_id IS NOT NULL
         RETURNING user_id
        """, uid
    )
    if not row:
        await callback.answer("This request is no longer pending.", show_alert=True)
        return
    try:
        await bot.send_message(int(uid), "Your MeetStrangers4u profile picture was not approved. You can submit another picture using /setprofilepic.")
    except Exception:
        logging.warning("Could not notify profile photo decline for user %s", uid)
    await callback.message.edit_caption((callback.message.caption or "") + "\n\n❌ DECLINED", reply_markup=None)
    await callback.answer("Profile picture declined.")

@dp.message(Command("explore"))
async def explore_command(message: Message):
    uid = str(message.from_user.id)
    approved = await db_pool.fetchval(
        "SELECT approved_file_id IS NOT NULL FROM public.explore_profile_photos WHERE user_id=$1",
        uid
    )
    if not approved:
        await message.answer(
            "You can explore other members only after setting your own profile picture.\n\n"
            "Use /setprofilepic to submit your picture for approval."
        )
        return
    markup = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text="Open Explore 🌍",
            web_app=WebAppInfo(url=PROFILE_PHOTO_WEBAPP)
        )
    ]])
    await message.answer("Discover new people on MeetStrangers4u.", reply_markup=markup)
```

## 3. Imports and command menu

Add missing imports only if they are not already present:

```python
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from datetime import datetime
import html
```

Add `BotCommand(command="setprofilepic", description="Set your Explore profile picture")`
and `BotCommand(command="explore", description="Discover member profiles")`
to the existing command list in `main()`.

## Important

- The photo-upload handler is state-filtered to actual photos only. Slash commands
  are not consumed by it, so normal commands can still execute while the user is
  waiting to upload.
- The old approved photo is retained until the admin accepts the replacement.
- Admin callbacks are restricted to `ADMIN_ID`.
- This guide is a patch reference, not an applied change to the live VPS bot.
- Check the existing import aliases and `ProfileStates` declaration before pasting.
