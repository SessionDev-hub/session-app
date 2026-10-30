// ps-host: loads VST3 effect plugins for Private Studio and processes audio for them.
//
// Private Studio starts this program with:  --port <n> --token <hex> --cache <xml> --pedal <txt> --list-json <json>
// This program connects back to 127.0.0.1:<n>, says hello with the token, then serves commands.
// Wire format (both ways): [u32 LE length][u8 type][payload]; length = 1 + payload size.
//   type 0: UTF-8 JSON      type 1: audio = [u32 inst][u32 seq][u16 channels][u16 frames][float32 planar]
// Plugins can only be loaded by identifier from the scanned list, never from an arbitrary path.

#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_data_structures/juce_data_structures.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <atomic>
#include <cstring>
#include <map>
#include <memory>
#include <vector>

using namespace juce;

namespace
{
constexpr uint8 kJson = 0;
constexpr uint8 kAudio = 1;

struct EditorWindow : public DocumentWindow
{
    EditorWindow (const String& title, std::function<void()> closeFn)
        : DocumentWindow (title, Colours::darkgrey, DocumentWindow::closeButton | DocumentWindow::minimiseButton),
          onClose (std::move (closeFn))
    {
        setUsingNativeTitleBar (true);
    }

    void closeButtonPressed() override { if (onClose) onClose(); }

    std::function<void()> onClose;
};

struct Instance
{
    int id = 0;
    String name;
    std::unique_ptr<AudioPluginInstance> proc;
    std::unique_ptr<EditorWindow> window;
    std::atomic<bool> ready { false };
    std::atomic<bool> bypass { false };
    CriticalSection lock;       // guards proc (audio thread vs. state/destroy on the message thread)
    AudioBuffer<float> buffer;
    int channels = 2;           // channels allocated in `buffer`
    int mainIn = 2;
    int mainOut = 2;
};

DynamicObject::Ptr makeEvt (const String& name)
{
    DynamicObject::Ptr o = new DynamicObject();
    o->setProperty ("evt", name);
    return o;
}
} // namespace

class HostApp : public JUCEApplication
{
public:
    const String getApplicationName() override { return "ps-host"; }
    const String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise (const String&) override
    {
        auto args = getCommandLineParameterArray();
        for (int i = 0; i + 1 < args.size(); ++i)
        {
            if (args[i] == "--port")           port = args[i + 1].getIntValue();
            else if (args[i] == "--token")     token = args[i + 1];
            else if (args[i] == "--cache")     cacheFile = File (args[i + 1]);
            else if (args[i] == "--pedal")     pedalFile = File (args[i + 1]);
            else if (args[i] == "--list-json") listJsonFile = File (args[i + 1]);
        }

        if (port <= 0 || token.isEmpty())
        {
            quit();
            return;
        }

        addDefaultFormatsToManager (formats); // VST3 only, see JUCE_PLUGINHOST_* in CMakeLists.txt (JUCE 8.0.11+ API)
        loadCache();

        link = std::make_unique<Link> (*this);
        link->startThread();
    }

    void shutdown() override
    {
        if (scanThread != nullptr)
            scanThread->stopThread (3000);
        scanThread.reset();

        link.reset(); // stops the network thread

        std::map<int, std::shared_ptr<Instance>> all;
        {
            ScopedLock sl (mapLock);
            all.swap (instances);
        }
        for (auto& kv : all)
        {
            kv.second->ready = false;
            kv.second->window.reset(); // editor must go before its processor
            ScopedLock sl (kv.second->lock);
            kv.second->proc.reset();
        }
    }

    void anotherInstanceStarted (const String&) override {}

private:
    /* ---------------- network ---------------- */

    class Link : public Thread
    {
    public:
        explicit Link (HostApp& a) : Thread ("ps-link"), app (a) {}
        ~Link() override { stopThread (2000); }

        void run() override
        {
            if (! socket.connect ("127.0.0.1", app.port, 5000))
            {
                quitApp();
                return;
            }

            auto hello = makeEvt ("hello");
            hello->setProperty ("token", app.token);
            auto text = JSON::toString (var (hello.get()), true);
            sendFrame (kJson, text.toRawUTF8(), (size_t) text.getNumBytesAsUTF8());

            while (! threadShouldExit())
            {
                const int ready = socket.waitUntilReady (true, 200);
                if (ready < 0) break;
                if (ready == 0) continue;

                uint32 len = 0;
                if (! readAll (&len, 4)) break;
                if (len == 0 || len > 64u * 1024u * 1024u) break;

                std::vector<uint8> data (len);
                if (! readAll (data.data(), (int) len)) break;
                app.onFrame (data[0], data.data() + 1, (size_t) len - 1);
            }
            quitApp();
        }

        void sendFrame (uint8 type, const void* payload, size_t n)
        {
            ScopedLock sl (sendLock);
            if (! socket.isConnected()) return;

            std::vector<uint8> out (5 + n);
            const uint32 len = (uint32) n + 1;
            std::memcpy (out.data(), &len, 4); // Windows is little-endian
            out[4] = type;
            if (n > 0) std::memcpy (out.data() + 5, payload, n);

            size_t done = 0;
            while (done < out.size())
            {
                const int w = socket.write (out.data() + done, (int) (out.size() - done));
                if (w <= 0) return;
                done += (size_t) w;
            }
        }

    private:
        bool readAll (void* dst, int n) { return socket.read (dst, n, true) == n; }
        static void quitApp() { MessageManager::callAsync ([] { JUCEApplicationBase::quit(); }); }

        HostApp& app;
        StreamingSocket socket;
        CriticalSection sendLock;
    };

    void emit (DynamicObject::Ptr o)
    {
        if (link == nullptr) return;
        auto text = JSON::toString (var (o.get()), true);
        link->sendFrame (kJson, text.toRawUTF8(), (size_t) text.getNumBytesAsUTF8());
    }

    void emitError (int inst, const String& message)
    {
        auto o = makeEvt ("error");
        o->setProperty ("inst", inst);
        o->setProperty ("message", message);
        emit (o);
    }

    void onFrame (uint8 type, const uint8* data, size_t n)
    {
        if (type == kAudio)
        {
            handleAudio (data, n);
            return;
        }
        if (type == kJson)
        {
            auto v = JSON::parse (String::fromUTF8 ((const char*) data, (int) n));
            MessageManager::callAsync ([this, v] { handleCommand (v); });
        }
    }

    /* ---------------- audio (runs on the network thread) ---------------- */

    std::shared_ptr<Instance> find (int id)
    {
        ScopedLock sl (mapLock);
        auto it = instances.find (id);
        return it == instances.end() ? nullptr : it->second;
    }

    void handleAudio (const uint8* d, size_t n)
    {
        if (n < 12) return;
        uint32 id = 0, seq = 0;
        uint16 ch = 0, frames = 0;
        std::memcpy (&id, d, 4);
        std::memcpy (&seq, d + 4, 4);
        std::memcpy (&ch, d + 8, 2);
        std::memcpy (&frames, d + 10, 2);
        juce::ignoreUnused (seq);
        if (ch != 2 || frames == 0 || n < 12 + (size_t) ch * frames * sizeof (float)) return;

        std::vector<uint8> out (d, d + n); // starts as a copy of the input = pass-through
        const size_t bytes = (size_t) frames * sizeof (float);

        auto inst = find ((int) id);
        if (inst != nullptr && inst->ready && ! inst->bypass)
        {
            ScopedLock sl (inst->lock);
            if (inst->proc != nullptr)
            {
                ScopedNoDenormals noDenormals;
                auto& b = inst->buffer;
                b.setSize (inst->channels, (int) frames, false, false, true);
                b.clear();

                const uint8* inL = d + 12;
                const uint8* inR = inL + bytes;
                if (inst->mainIn >= 2)
                {
                    std::memcpy (b.getWritePointer (0), inL, bytes);
                    std::memcpy (b.getWritePointer (1), inR, bytes);
                }
                else // mono plugin: mix the two channels down
                {
                    std::vector<float> l (frames), r (frames);
                    std::memcpy (l.data(), inL, bytes);
                    std::memcpy (r.data(), inR, bytes);
                    auto* w = b.getWritePointer (0);
                    for (int i = 0; i < (int) frames; ++i) w[i] = 0.5f * (l[(size_t) i] + r[(size_t) i]);
                }

                MidiBuffer midi;
                inst->proc->processBlock (b, midi);

                uint8* outL = out.data() + 12;
                uint8* outR = outL + bytes;
                std::memcpy (outL, b.getReadPointer (0), bytes);
                std::memcpy (outR, b.getReadPointer (inst->mainOut >= 2 && inst->channels > 1 ? 1 : 0), bytes);
            }
        }

        if (link != nullptr) link->sendFrame (kAudio, out.data(), out.size());
    }

    /* ---------------- commands (run on the message thread) ---------------- */

    void handleCommand (const var& c)
    {
        const String cmd = c["cmd"].toString();
        const int inst = (int) c["inst"];

        if (cmd == "list")           emitPlugins (true);
        else if (cmd == "scan")      startScan (c["folders"]);
        else if (cmd == "create")    createInstance (c);
        else if (cmd == "destroy")   destroyInstance (inst);
        else if (cmd == "bypass")    { if (auto i = find (inst)) i->bypass = (bool) c["on"]; }
        else if (cmd == "openEditor")  openEditor (inst);
        else if (cmd == "closeEditor") closeEditorNow (inst, false);
        else if (cmd == "getState")  sendState (inst, (int) c["req"]);
        else if (cmd == "setState")  applyState (inst, c["state"].toString());
        else if (cmd == "ping")      emit (makeEvt ("pong"));
    }

    void createInstance (const var& c)
    {
        const int id = (int) c["inst"];
        const String ident = c["id"].toString();
        const double sr = (double) c["sampleRate"] > 0 ? (double) c["sampleRate"] : 48000.0;
        const int block = (int) c["block"] > 0 ? (int) c["block"] : 512;

        auto found = known.getTypeForIdentifierString (ident);
        if (found == nullptr)
        {
            emitError (id, "Plugin not found. Rescan your plugins.");
            return;
        }
        std::shared_ptr<PluginDescription> desc (found.release());

        formats.createPluginInstanceAsync (*desc, sr, block,
            [this, id, sr, block, desc] (std::unique_ptr<AudioPluginInstance> p, const String& err)
            {
                if (p == nullptr)
                {
                    emitError (id, err.isEmpty() ? String ("The plugin could not be loaded") : err);
                    return;
                }

                // stereo in / stereo out on the main buses; side-chain and other buses stay as the plugin defaults
                auto layout = p->getBusesLayout();
                if (p->getBusCount (true) > 0)  layout.getChannelSet (true, 0)  = AudioChannelSet::stereo();
                if (p->getBusCount (false) > 0) layout.getChannelSet (false, 0) = AudioChannelSet::stereo();
                p->setBusesLayout (layout); // if refused, the plugin keeps its own layout and we adapt in handleAudio

                p->setNonRealtime (false);
                p->prepareToPlay (sr, 4096);

                auto inst = std::make_shared<Instance>();
                inst->id = id;
                inst->name = desc->name;
                inst->mainIn = p->getMainBusNumInputChannels();
                inst->mainOut = p->getMainBusNumOutputChannels();
                inst->channels = jmax (2, p->getTotalNumInputChannels(), p->getTotalNumOutputChannels());
                inst->buffer.setSize (inst->channels, block);
                const bool hasEditor = p->hasEditor();
                const int latency = p->getLatencySamples();
                inst->proc = std::move (p);
                inst->ready = true;

                {
                    ScopedLock sl (mapLock);
                    instances[id] = inst;
                }

                auto o = makeEvt ("created");
                o->setProperty ("inst", id);
                o->setProperty ("latency", latency);
                o->setProperty ("hasEditor", hasEditor);
                o->setProperty ("name", desc->name);
                emit (o);
            });
    }

    void destroyInstance (int id)
    {
        std::shared_ptr<Instance> inst;
        {
            ScopedLock sl (mapLock);
            auto it = instances.find (id);
            if (it == instances.end()) return;
            inst = it->second;
            instances.erase (it);
        }
        inst->ready = false;
        inst->window.reset();
        ScopedLock sl (inst->lock);
        if (inst->proc != nullptr)
        {
            inst->proc->releaseResources();
            inst->proc.reset();
        }
    }

    void openEditor (int id)
    {
        auto inst = find (id);
        if (inst == nullptr || inst->proc == nullptr) return;
        if (inst->window != nullptr)
        {
            inst->window->toFront (true);
            return;
        }
        if (! inst->proc->hasEditor())
        {
            emitError (id, "This plugin has no window of its own");
            return;
        }
        auto* editor = inst->proc->createEditorAndMakeActive();
        if (editor == nullptr) return;

        inst->window = std::make_unique<EditorWindow> (inst->name, [this, id]
        {
            // do not destroy the window from inside its own callback
            MessageManager::callAsync ([this, id] { closeEditorNow (id, true); });
        });
        inst->window->setContentOwned (editor, true);
        inst->window->setResizable (editor->isResizable(), false);
        inst->window->centreWithSize (inst->window->getWidth(), inst->window->getHeight());
        inst->window->setVisible (true);
    }

    void closeEditorNow (int id, bool notify)
    {
        auto inst = find (id);
        if (inst == nullptr) return;
        inst->window.reset();
        if (notify)
        {
            auto o = makeEvt ("editorClosed");
            o->setProperty ("inst", id);
            emit (o);
        }
    }

    void sendState (int id, int req)
    {
        String b64;
        if (auto inst = find (id))
        {
            MemoryBlock mb;
            {
                ScopedLock sl (inst->lock);
                if (inst->proc != nullptr) inst->proc->getStateInformation (mb);
            }
            b64 = Base64::toBase64 (mb.getData(), mb.getSize());
        }
        auto o = makeEvt ("state");
        o->setProperty ("inst", id);
        o->setProperty ("req", req);
        o->setProperty ("state", b64);
        emit (o);
    }

    void applyState (int id, const String& b64)
    {
        auto inst = find (id);
        if (inst == nullptr || b64.isEmpty()) return;
        MemoryOutputStream mo;
        if (! Base64::convertFromBase64 (mo, b64)) return;
        ScopedLock sl (inst->lock);
        if (inst->proc != nullptr) inst->proc->setStateInformation (mo.getData(), (int) mo.getDataSize());
    }

    /* ---------------- scanning ---------------- */

    class ScanThread : public Thread
    {
    public:
        ScanThread (HostApp& a, StringArray extra) : Thread ("ps-scan"), app (a), folders (std::move (extra)) {}
        ~ScanThread() override { stopThread (3000); }

        void run() override
        {
            for (int f = 0; f < app.formats.getNumFormats() && ! threadShouldExit(); ++f)
            {
                auto* format = app.formats.getFormat (f);
                FileSearchPath path = format->getDefaultLocationsToSearch();
                for (auto& folder : folders) path.add (File (folder));

                PluginDirectoryScanner scanner (app.known, *format, path, true, app.pedalFile, false);
                String name;
                while (! threadShouldExit() && scanner.scanNextFile (true, name))
                {
                    auto o = makeEvt ("scanProgress");
                    o->setProperty ("name", name);
                    o->setProperty ("found", app.known.getNumTypes());
                    app.emit (o);
                }
            }
            app.saveCache();
            app.emitPlugins (true);
        }

    private:
        HostApp& app;
        StringArray folders;
    };

    void startScan (const var& folders)
    {
        if (scanThread != nullptr && scanThread->isThreadRunning()) return;
        StringArray extra;
        if (auto* arr = folders.getArray())
            for (auto& v : *arr) extra.add (v.toString());
        scanThread = std::make_unique<ScanThread> (*this, extra);
        scanThread->startThread();
    }

    var pluginsAsVar()
    {
        Array<var> arr;
        for (auto& d : known.getTypes())
        {
            DynamicObject::Ptr p = new DynamicObject();
            p->setProperty ("id", d.createIdentifierString());
            p->setProperty ("name", d.name);
            p->setProperty ("vendor", d.manufacturerName);
            p->setProperty ("path", d.fileOrIdentifier);
            p->setProperty ("format", d.pluginFormatName);
            p->setProperty ("instrument", d.isInstrument);
            p->setProperty ("inputs", d.numInputChannels);
            p->setProperty ("outputs", d.numOutputChannels);
            arr.add (var (p.get()));
        }
        return var (arr);
    }

    void emitPlugins (bool done)
    {
        auto o = makeEvt ("plugins");
        o->setProperty ("plugins", pluginsAsVar());
        o->setProperty ("done", done);
        emit (o);
    }

    void loadCache()
    {
        if (cacheFile.existsAsFile())
            if (auto xml = parseXML (cacheFile))
                known.recreateFromXml (*xml);
    }

    void saveCache()
    {
        if (cacheFile != File())
        {
            cacheFile.getParentDirectory().createDirectory();
            if (auto xml = known.createXml()) xml->writeTo (cacheFile);
        }
        if (listJsonFile != File())
        {
            listJsonFile.getParentDirectory().createDirectory();
            listJsonFile.replaceWithText (JSON::toString (pluginsAsVar(), false));
        }
    }

    /* ---------------- state ---------------- */

    int port = 0;
    String token;
    File cacheFile, pedalFile, listJsonFile;

    AudioPluginFormatManager formats;
    KnownPluginList known;

    CriticalSection mapLock;
    std::map<int, std::shared_ptr<Instance>> instances;

    std::unique_ptr<ScanThread> scanThread;
    std::unique_ptr<Link> link;
};

START_JUCE_APPLICATION (HostApp)
